"""
train_vggface2.py
=================
Phase 1: Pretrain custom CNN on VGGFace2 dataset.

WHAT THIS DOES:
  Trains the full custom CNN (Path C architecture, ~80M params) on
  VGGFace2 using triplet loss. The network learns to extract meaningful
  face embeddings that separate different identities.

WHY PRETRAIN:
  Training from scratch on random pixels produces garbage. By pretraining
  on VGGFace2 (3.3M images, 9K identities), the network learns:
  - How to detect edges, textures, facial parts
  - How to build a hierarchical representation of faces
  - A general face embedding space where similar faces are close

After this phase, you get a model that can extract good face features
for ANY face. This is the foundation Phase 2 builds on.

ARCHITECTURE:
  6 Conv2D blocks with BatchNorm + MaxPooling
  -> Flatten -> Dense(1024) -> Dropout(0.3) -> Dense(512) -> L2 Normalize
  -> Triplet Loss: max(d(A,P) - d(A,N) + margin, 0)

PARAMETERS: ~80M
  - Conv blocks: ~28M (128+256+256+512+512+1024 filters)
  - Dense(1024): 50,176 x 1,024 = ~51.2M
  - Dense(512): 1,024 x 512 = ~0.5M
  Total: ~97.5M parameters (224/448/576/896/1152/3072 channel widths,
  4096-dim fc1 -- see CustomCNN for the actual current sizes)

TRAINING DETAILS:
  - Loss: Triplet margin loss (margin=0.2)
  - Optimizer: Adam (lr=1e-4, weight_decay=0 -- see CustomCNN docstring)
  - Batch size: 32 (fits in 32GB VRAM)
  - Epochs: 40 (optimal - see PIPELINE.md)
  - Checkpoint: Every 10 epochs (auto-resume)
  - Triplet mining: Semi-hard (mines hardest negatives each batch)

USAGE:
  python train_vggface2.py

CHECKPOINTING:
  If training crashes or you stop it, just run this script again.
  It automatically loads the latest checkpoint and resumes.
"""

import os
import sys
import time
import random
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader, Dataset
import torchvision
import torchvision.transforms.functional as TF
import numpy as np
from PIL import Image


# ── CONFIG ────────────────────────────────────────────────────────────────
EXTRACTED_PATH = "/home/b2/projects/zavrsni/face_recognition/extracted_faces"
CHECKPOINT_DIR = "/home/b2/projects/zavrsni/face_recognition/training_checkpoints"

BATCH_SIZE = 32          # Larger batches (64, 256 tested) hit an untuned rocBLAS
                         # fallback kernel on this GPU and run ~3x slower per
                         # epoch despite using more VRAM. 32 is empirically fastest.
EPOCH_SIZE = 85_000      # Images sampled (with replacement) per "epoch". A true
                         # full pass over all 749,553 images took 314min/epoch --
                         # 40 of those would be ~209h (8.7 days). Sampling a
                         # fixed subset per epoch instead decouples "epoch" from
                         # dataset size, restoring ~35min/epoch: enough for
                         # frequent checkpoints/collapse-checks (this pipeline
                         # has twice needed those to catch problems fast) while
                         # 40 epochs x 85,000 ~= 4.5 full passes over the data
                         # in ~24h total.
NUM_EPOCHS = 60          # Extended from 40: loss was still decreasing every
                         # single epoch (no plateau) and verification
                         # separation (quick_verify_check.py) was still
                         # climbing at epoch 30 (0.35 -> 0.40 -> 0.46,
                         # epochs 10/20/30, accelerating if anything) with
                         # classification accuracy only ~21% on a
                         # 19,203-way problem -- real headroom left.
LEARNING_RATE = 1e-4     # 1e-3 was unstable on the 97.5M-param model (fast
                         # embedding contraction in first ~60 steps); 1e-4
                         # settles instead of collapsing.
WARM_RESTART_EPOCH = 40  # The original run's cosine cycle (T_max=40) decayed
                         # LR to ~1e-6 by epoch 40 -- resuming past that with
                         # the *same* schedule would make CosineAnnealingLR's
                         # periodic formula start climbing LR back toward 1e-4
                         # (a real bug, not a feature). Epochs 41-60 instead
                         # get a fresh, independent cosine cycle (standard
                         # "warm restart" / SGDR practice) -- see main().
WARM_RESTART_LR = 1e-5   # Restart LR for epoch 41: 10x below the original
                         # start (1e-4) since the model is already
                         # well-trained and doesn't need coarse early steps
                         # again, but well above the ~1e-6 floor the first
                         # cycle ended at -- needs *some* room to actually
                         # move and find further improvement, not just
                         # fine-tune in place.
MARGIN = 0.2             # Unused by the current classification loss; kept for
                         # TripletMarginLossWithMining, retained for reference.
DROPOUT_RATE = 0.3       # Dropout before embedding layer
SAVE_INTERVAL = 1        # Save checkpoint every epoch -- cheap since
                         # save_checkpoint() prunes to the 3 most recent
                         # files regardless of interval (disk is only
                         # ~13GB free, each checkpoint ~1.3GB), so more
                         # frequent saves cost a few extra seconds/epoch,
                         # not more disk. Gives a rollback point after
                         # every epoch if a change (e.g. the LR schedule
                         # below) turns out to hurt training.

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
print(f"Device: {DEVICE}")
if torch.cuda.is_available():
    print(f"GPU: {torch.cuda.get_device_name(0)}")
    print(f"VRAM: {torch.cuda.get_device_properties(0).total_memory / 1e9:.1f} GB")
    torch.cuda.empty_cache()
    # MI50 (gfx906): the bundled libMIOpen.so segfaults inside
    # miopen::GetUserDbPath() on this system's libstdc++ (ABI mismatch in
    # std::filesystem::path between the toolchains). Disabling routes
    # conv2d through the native/rocBLAS path instead of MIOpen, which
    # works correctly (just without MIOpen's autotuned conv kernels).
    torch.backends.cudnn.enabled = False


# ── CUSTOM CNN (PATH C, ~80M PARAMS) ─────────────────────────────────────
#
# CHANGES FROM ORIGINAL app.py:
#   1. Added BatchNorm after every Conv2D (stabilizes training)
#   2. Added residual shortcut connections (mini-ResNet style)
#   3. Added Dropout(0.3) before embedding (prevents overfitting)
#   4. Changed output to Dense(512) with L2 normalization
#   5. Replaced sigmoid activation with linear
#   6. 6 conv blocks instead of 4 (deeper feature extraction)
#

class CustomCNN(nn.Module):
    """
    Custom CNN for face embedding (Path C architecture, ~97.5M params).

    Architecture:
        Block 1: Conv2D(224, 11x11)  -> BN -> ReLU -> MaxPool(2)
        Block 2: Conv2D(448, 7x7)    -> BN -> ReLU -> MaxPool(2)
        Block 3: Conv2D(576, 5x5)    -> BN -> ReLU -> MaxPool(2)
        Block 4: Conv2D(896, 3x3)    -> BN -> ReLU -> MaxPool(2)
        Block 5: Conv2D(1152, 3x3)   -> BN -> ReLU
        Block 6: Conv2D(3072, 3x3)   -> BN -> ReLU

        Flatten -> Dense(4096) -> Dropout -> Dense(512) -> L2 Normalize

    NOTE on weight_decay: every conv here is immediately followed by
    BatchNorm, which makes the loss scale-invariant to that conv's
    weights. L2 weight_decay on those weights has no restoring force and
    decays them toward zero indefinitely (well-documented Adam+L2+BN
    interaction) -- an earlier run of this exact architecture collapsed
    to a constant embedding after ~20 epochs this way (weights hit
    float32 subnormal range, ~1e-41). The optimizer must use
    weight_decay=0.
    """
    def __init__(self, embedding_dim=512):
        super(CustomCNN, self).__init__()
        c1, c2, c3, c4, c5, c6, fc1_dim = 224, 448, 576, 896, 1152, 3072, 4096

        # BLOCK 1 - Large kernel captures broad facial patterns
        self.block1 = nn.Sequential(
            nn.Conv2d(3, c1, kernel_size=11, stride=1, padding=0),  # 105->95
            nn.BatchNorm2d(c1), nn.ReLU(inplace=True),
            nn.MaxPool2d(2),  # 95->47
            nn.Conv2d(c1, c1, kernel_size=3, padding=1),  # 47->47
            nn.BatchNorm2d(c1), nn.ReLU(inplace=True),
        )

        # BLOCK 2 - Medium kernel combines local patterns
        self.block2 = nn.Sequential(
            nn.Conv2d(c1, c2, kernel_size=7, stride=1, padding=0),  # 47->41
            nn.BatchNorm2d(c2), nn.ReLU(inplace=True),
            nn.MaxPool2d(2),  # 41->20
            nn.Conv2d(c2, c2, kernel_size=3, padding=1),  # 20->20
            nn.BatchNorm2d(c2), nn.ReLU(inplace=True),
        )

        # BLOCK 3 - Smaller kernel for finer details
        self.block3 = nn.Sequential(
            nn.Conv2d(c2, c3, kernel_size=5, stride=1, padding=0),  # 20->16
            nn.BatchNorm2d(c3), nn.ReLU(inplace=True),
            nn.MaxPool2d(2),  # 16->8
            nn.Conv2d(c3, c3, kernel_size=3, padding=1),  # 8->8
            nn.BatchNorm2d(c3), nn.ReLU(inplace=True),
        )
        self.res3 = nn.Conv2d(c3, c3, kernel_size=1)

        # BLOCK 4 - Many channels for complex features
        self.block4 = nn.Sequential(
            nn.Conv2d(c3, c4, kernel_size=3, stride=1, padding=0),  # 8->6
            nn.BatchNorm2d(c4), nn.ReLU(inplace=True),
            nn.MaxPool2d(2),  # 6->3
            nn.Conv2d(c4, c4, kernel_size=3, padding=1),  # 3->3
            nn.BatchNorm2d(c4), nn.ReLU(inplace=True),
        )
        self.res4 = nn.Conv2d(c4, c4, kernel_size=1)

        # BLOCK 5 - Same depth, more capacity
        self.block5 = nn.Sequential(
            nn.Conv2d(c4, c5, kernel_size=3, stride=1, padding=0),  # 3->1
            nn.BatchNorm2d(c5), nn.ReLU(inplace=True),
            nn.Conv2d(c5, c5, kernel_size=3, padding=1),  # 1->1
            nn.BatchNorm2d(c5), nn.ReLU(inplace=True),
        )

        # BLOCK 6 - Final block with max channels
        self.block6 = nn.Sequential(
            nn.Conv2d(c5, c6, kernel_size=3, stride=1, padding=1),  # 1->1
            nn.BatchNorm2d(c6), nn.ReLU(inplace=True),
        )

        # DENSE LAYERS
        self.flatten = nn.Flatten()
        self.fc1 = nn.Linear(c6, fc1_dim)
        self.dropout = nn.Dropout(DROPOUT_RATE)
        self.fc2 = nn.Linear(fc1_dim, embedding_dim)

    def forward(self, x):
        # Forward pass with residual connections
        out = self.block1(x)

        out = self.block2(out)

        out = self.block3(out)
        out = out + self.res3(out)

        out = self.block4(out)
        out = out + self.res4(out)

        out = self.block5(out)
        out = self.block6(out)

        # Flatten + project to embedding space
        out = self.flatten(out)       # (batch, 1024)
        out = self.fc1(out)           # (batch, 1024)
        out = self.dropout(out)       # (batch, 1024) with 30% zeroed
        out = self.fc2(out)           # (batch, 512)
        out = nn.functional.normalize(out, p=2, dim=1)  # L2 normalize
        return out


# ── DATASET ───────────────────────────────────────────────────────────────

class VGGFace2Dataset(Dataset):
    """
    VGGFace2 face dataset loader.

    Loads extracted faces from disk and provides (image, identity_label) pairs.
    Images are normalized to ImageNet mean/std for stable training.
    """
    def __init__(self, base_path, transform=None):
        self.base_path = base_path
        self.transform = transform
        self.samples = []

        identity_dirs = sorted([
            d for d in os.listdir(base_path)
            if os.path.isdir(os.path.join(base_path, d))
        ])
        self.identities = identity_dirs
        self.identity_to_idx = {identity: i for i, identity in enumerate(identity_dirs)}

        for identity in identity_dirs:
            identity_dir = os.path.join(base_path, identity)
            img_files = sorted([
                f for f in os.listdir(identity_dir)
                if f.endswith(('.png', '.jpg', '.jpeg'))
            ])
            for img_file in img_files:
                self.samples.append((
                    os.path.join(identity_dir, img_file),
                    identity
                ))

        print(f"[Dataset] Loaded {len(self.samples):,} images from {len(self.identities)} identities")

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        img_path, identity = self.samples[idx]
        image = Image.open(img_path).convert('RGB')

        if self.transform:
            image = self.transform(image)

        label = self.identity_to_idx[identity]
        return image, label


# ── TRIPLET LOSS WITH SEMI-HARD MINING ────────────────────────────────────

class TripletMarginLossWithMining(nn.Module):
    """
    Triplet margin loss with semi-hard negative mining.

    Formula: L = max(d(a,p) - d(a,n) + margin, 0)

    SEMI-HARD MINING:
        We pick triplets where the negative is:
        - Farther from anchor than the positive (d(a,n) > d(a,p))
        - But not too far (d(a,n) < d(a,p) + margin)

        This gives the best learning signal: not too easy (no gradient),
        not too hard (noisy gradient).

    WHY SEMI-HARD OVER RANDOM:
        Random triplets waste compute on already-easy pairs (d(a,n) >> d(a,p)+margin).
        Semi-hard mining focuses on the boundary between classes, where the
        network needs the most help learning.

    ANTI-COLLAPSE TERM:
        Triplet loss only constrains the RELATIVE gap d(a,n) - d(a,p), so
        shrinking every embedding toward the same point can trivially
        satisfy the margin for whatever triplets got mined, without the
        network learning anything discriminative -- a documented failure
        mode of triplet loss (see e.g. "Deep Metric Learning via Lifted
        Structured Feature Embedding", Song et al.), and exactly what
        happened in an earlier run of this pipeline (embeddings became
        bit-identical across different real people, loss froze at the
        margin value). `min_neg_dist`/`collapse_weight` add a direct
        penalty whenever the mean distance between DIFFERENT-identity
        embeddings in a batch drops below `min_neg_dist`, independent of
        whether weight_decay/lr happen to be tuned exactly right.
    """
    def __init__(self, margin=0.2, min_neg_dist=0.3, collapse_weight=20.0):
        super(TripletMarginLossWithMining, self).__init__()
        self.margin = margin
        self.min_neg_dist = min_neg_dist
        self.collapse_weight = collapse_weight

    def forward(self, embeddings, labels):
        # Compute pairwise Euclidean distances between all embeddings
        dist_matrix = self._pdist(embeddings)  # (batch, batch)

        # Positive mask: same identity, not self
        pos_mask = (labels.unsqueeze(0) == labels.unsqueeze(1)) & \
                   (~torch.eye(len(labels), dtype=bool, device=labels.device))

        # Negative mask: different identity
        neg_mask = (labels.unsqueeze(0) != labels.unsqueeze(1))

        # For each anchor, find nearest positive distance
        min_pos_dist = torch.full((len(labels),), float('inf'), device=labels.device)
        for i in range(len(labels)):
            pos_dists = dist_matrix[i][pos_mask[i]]
            if len(pos_dists) > 0:
                min_pos_dist[i] = pos_dists.min()

        # Semi-hard mask: d(a,p) < d(a,n) < d(a,p) + margin
        semi_hard_mask = neg_mask & \
                         (dist_matrix > min_pos_dist.unsqueeze(1)) & \
                         (dist_matrix < min_pos_dist.unsqueeze(1) + self.margin)

        # Also accept easy negatives for stability
        easy_neg_mask = neg_mask & (dist_matrix >= min_pos_dist.unsqueeze(1) + self.margin)

        valid_mask = semi_hard_mask | easy_neg_mask

        loss_sum = 0.0
        count = 0

        for i in range(len(labels)):
            valid_negs = valid_mask[i]
            if valid_negs.any():
                neg_dists = dist_matrix[i][valid_negs]
                best_neg_dist = neg_dists.min()  # Hardest valid negative
                triplet_loss = torch.clamp(
                    best_neg_dist - min_pos_dist[i] + self.margin, min=0)
                loss_sum += triplet_loss
                count += 1

        triplet = loss_sum / count if count > 0 else torch.tensor(0.0, device=embeddings.device)

        # Anti-collapse term: triplet loss only constrains RELATIVE
        # distances (d(a,n) - d(a,p)), so shrinking the whole embedding
        # space toward a single point can trivially satisfy the mined
        # triplets without learning anything discriminative -- this is
        # exactly what happened in an earlier run (all embeddings became
        # bit-identical, loss froze at the margin value). Penalize the
        # mean distance between DIFFERENT-identity embeddings in the
        # batch if it drops below a floor, giving the optimizer a direct,
        # constant counter-pressure against collapse that doesn't depend
        # on getting weight_decay/lr exactly right.
        neg_dists_all = dist_matrix[neg_mask]
        if neg_dists_all.numel() > 0:
            mean_neg_dist = neg_dists_all.mean()
            # Squared hinge, not linear: a linear penalty (collapse_weight=1.0)
            # applies the same constant restoring force no matter how close
            # to collapse the batch already is, and empirically wasn't
            # enough to stop a slow full-epoch drift (0.22 at 400 steps ->
            # 0.085 by epoch end). Squaring makes the restoring force grow
            # the deeper the violation, which is the actual behavior needed
            # to hold a floor rather than just slow the approach to it.
            collapse_penalty = torch.clamp(self.min_neg_dist - mean_neg_dist, min=0) ** 2
        else:
            collapse_penalty = torch.tensor(0.0, device=embeddings.device)

        return triplet + self.collapse_weight * collapse_penalty

    @staticmethod
    def _pdist(embeddings):
        """Pairwise Euclidean distance matrix."""
        # For L2-normalized embeddings: ||a-b||^2 = 2 - 2*a.b
        dot = torch.mm(embeddings, embeddings.t())
        dist_sq = 2.0 - 2.0 * dot
        dist_sq = torch.clamp(dist_sq, min=0.0)
        return torch.sqrt(dist_sq + 1e-8)


# ── TRAINING FUNCTIONS ───────────────────────────────────────────────────

class PKSampler(torch.utils.data.Sampler):
    """
    Samples P identities x K images per batch (P*K = batch_size).

    Triplet mining needs same-identity pairs inside each batch. With
    10K+ identities, a plain RandomSampler almost never puts two images
    of the same person in one batch of 32 (expected ~0.05 same-identity
    pairs per batch), so semi-hard mining would starve. PK sampling
    guarantees every identity in the batch has >=1 positive partner.
    """
    def __init__(self, dataset, p=8, k=4):
        self.p = p
        self.k = k
        self.identity_to_indices = {}
        for idx, (_, identity) in enumerate(dataset.samples):
            self.identity_to_indices.setdefault(identity, []).append(idx)
        self.identities = [
            ident for ident, idxs in self.identity_to_indices.items()
            if len(idxs) >= 2
        ]

    def __iter__(self):
        identities = self.identities.copy()
        random.shuffle(identities)
        num_batches = len(identities) // self.p
        for b in range(num_batches):
            batch_ids = identities[b * self.p:(b + 1) * self.p]
            batch = []
            for ident in batch_ids:
                idxs = self.identity_to_indices[ident]
                if len(idxs) >= self.k:
                    batch.extend(random.sample(idxs, self.k))
                else:
                    batch.extend(random.choices(idxs, k=self.k))
            yield batch

    def __len__(self):
        return len(self.identities) // self.p


def create_dataloaders(batch_size=32):
    """
    Create DataLoader with augmentation.

    Augmentation applied:
    - Resize to 105x105: matches the CNN's hardcoded input size
    - Random horizontal flip (50% chance): Mirroring a face is still valid
    - Color jitter (brightness/contrast): Simulates different lighting
    - ImageNet normalization: Standard preprocessing
    """
    transform = torchvision.transforms.Compose([
        torchvision.transforms.Resize((105, 105)),
        torchvision.transforms.RandomHorizontalFlip(0.5),
        torchvision.transforms.ColorJitter(
            brightness=0.1, contrast=0.1, saturation=0.05),
        torchvision.transforms.ToTensor(),
        torchvision.transforms.Normalize(
            mean=[0.485, 0.456, 0.406],
            std=[0.229, 0.224, 0.225]),
    ])

    dataset = VGGFace2Dataset(EXTRACTED_PATH, transform=transform)

    # Sample a fixed-size random subset (with replacement) per epoch rather
    # than a full pass over all 749,553 images -- see EPOCH_SIZE.
    sampler = torch.utils.data.RandomSampler(
        dataset, replacement=True, num_samples=EPOCH_SIZE)

    return DataLoader(
        dataset, batch_size=batch_size, sampler=sampler,
        num_workers=4, prefetch_factor=2, pin_memory=True,
        persistent_workers=True, drop_last=True,
    ), len(dataset.identities)


def train_step(model, classifier, dataloader, optimizer, criterion, device, scale):
    """
    One training step: forward -> cosine-scaled cross-entropy -> backward -> update.
    """
    model.train()
    classifier.train()
    total_loss = 0.0
    correct = 0
    total = 0
    count = 0

    for images, labels in dataloader:
        images = images.to(device)
        labels = labels.to(device)

        optimizer.zero_grad()
        embeddings = model(images)
        logits = scale * classifier(embeddings)
        loss = criterion(logits, labels)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(
            list(model.parameters()) + list(classifier.parameters()), max_norm=1.0)
        optimizer.step()

        total_loss += loss.item()
        correct += (logits.argmax(dim=1) == labels).sum().item()
        total += labels.size(0)
        count += 1

    avg_loss = total_loss / count if count > 0 else 0.0
    accuracy = correct / total if total > 0 else 0.0
    return avg_loss, accuracy


def save_checkpoint(model, classifier, optimizer, epoch, loss, path):
    """
    Save checkpoint with model weights, optimizer state, and epoch.

    WHAT'S SAVED:
    - model.state_dict(): All backbone weights (for model recovery)
    - classifier_state_dict: the Phase-1-only classification head, needed
      to resume training but NOT loaded by fine_tune.py/evaluate.py (they
      only use the backbone embedding, not the identity classifier)
    - optimizer.state_dict(): Adam momentum/velocity (for training recovery)
    - epoch: Resume from this point
    - loss: Track best model

    WHY SAVE OPTIMIZER STATE:
    Adam maintains running averages of gradients. Without it, resuming
    starts fresh and may destabilize training.
    """
    os.makedirs(os.path.dirname(path), exist_ok=True)
    torch.save({
        'epoch': epoch,
        'model_state_dict': model.state_dict(),
        'classifier_state_dict': classifier.state_dict(),
        'optimizer_state_dict': optimizer.state_dict(),
        'loss': loss,
    }, path)
    print(f"    Saved: {path} (epoch {epoch}, loss={loss:.4f})")

    # Prune old checkpoints -- disk is only ~9-13GB free and each checkpoint
    # is ~1.2GB (97.5M backbone + 9.8M classifier + Adam state for both).
    # Keep the 3 most recent epoch_*.pt files only. Milestone snapshots
    # (see save_milestone) use a different filename prefix on purpose, so
    # this glob never touches them.
    ckpt_dir = os.path.dirname(path)
    epoch_ckpts = sorted(
        (f for f in os.listdir(ckpt_dir) if f.startswith("epoch_") and f.endswith(".pt")),
        key=lambda f: int(f[len("epoch_"):-len(".pt")]),
    )
    for old in epoch_ckpts[:-3]:
        os.remove(os.path.join(ckpt_dir, old))


def save_milestone(model, classifier, epoch, loss, path):
    """
    Permanent snapshot at round-number epochs (10/20/30/40/50/60) -- never
    pruned, unlike save_checkpoint()'s rolling window. Deliberately
    lighter than a full checkpoint: no optimizer state (~1.2GB ->
    ~430MB), since a milestone's purpose is "a known-good model to fall
    back to or evaluate later," not exact-resume (which the rolling
    window already covers). Disk is too tight (~9GB free) to keep 4
    full checkpoints permanently on top of the rolling ones.
    """
    os.makedirs(os.path.dirname(path), exist_ok=True)
    torch.save({
        'epoch': epoch,
        'model_state_dict': model.state_dict(),
        'classifier_state_dict': classifier.state_dict(),
        'loss': loss,
    }, path)
    print(f"    Milestone saved (permanent, no optimizer state): {path}")


def load_checkpoint(model, classifier, optimizer, path):
    """Load checkpoint and return epoch number."""
    ckpt = torch.load(path, map_location=DEVICE, weights_only=True)
    model.load_state_dict(ckpt['model_state_dict'])
    classifier.load_state_dict(ckpt['classifier_state_dict'])
    optimizer.load_state_dict(ckpt['optimizer_state_dict'])
    print(f"    Resumed from epoch {ckpt['epoch']} (loss={ckpt['loss']:.4f})")
    return ckpt['epoch'], ckpt['loss']


# ── COLLAPSE DETECTION ───────────────────────────────────────────────────

def build_collapse_probe(device, n=8):
    """
    Fixed set of images from N different real identities, used every
    epoch to check the embedding space hasn't collapsed to a constant.

    A prior run of this architecture silently collapsed (every image ->
    identical embedding, loss frozen at exactly the margin value) and
    wasn't caught until 20+ epochs / ~2 hours in, because the loss number
    alone looked like slow-but-real progress. Checking actual embedding
    distances on real images every epoch catches this in ~5 minutes.
    """
    transform = torchvision.transforms.Compose([
        torchvision.transforms.Resize((105, 105)),
        torchvision.transforms.ToTensor(),
        torchvision.transforms.Normalize(mean=[0.485, 0.456, 0.406],
                                          std=[0.229, 0.224, 0.225]),
    ])
    identities = sorted(os.listdir(EXTRACTED_PATH))
    step = max(len(identities) // n, 1)
    imgs = []
    for identity in identities[::step][:n]:
        d = os.path.join(EXTRACTED_PATH, identity)
        fname = os.listdir(d)[0]
        img = Image.open(os.path.join(d, fname)).convert('RGB')
        imgs.append(transform(img))
    return torch.stack(imgs).to(device)


def check_collapse(model, probe_batch):
    """
    Returns mean pairwise embedding distance across the probe batch.

    Uses eval() (disables Dropout) but forces BatchNorm layers to use
    live statistics from the probe batch itself rather than the model's
    accumulated running_mean/running_var. Running stats start at their
    untouched defaults (mean=0, var=1) and only become meaningful after
    many steps, which makes eval-mode BN an unreliable/noisy signal early
    in training -- computing stats directly from the probe batch gives a
    clean read on whether the conv weights themselves have collapsed,
    independent of how far along the running-stat EMA is.
    """
    was_training = model.training
    model.eval()
    for m in model.modules():
        if isinstance(m, nn.BatchNorm2d):
            m.train()
    with torch.no_grad():
        emb = model(probe_batch)
        dist = torch.cdist(emb, emb)
        n = dist.shape[0]
        mean_dist = (dist.sum() / (n * n - n)).item()
    model.train(was_training)
    return mean_dist


# ── MAIN ──────────────────────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("  Phase 1: Pretrain Custom CNN on VGGFace2")
    print("=" * 60)
    print(f"  Architecture: CustomCNN (Path C, ~97.5M params)")
    print(f"  Loss: Cosine-scaled cross-entropy identity classification")
    print(f"  Epochs: {NUM_EPOCHS}, Batch: {BATCH_SIZE}, LR: {LEARNING_RATE}")
    print("=" * 60)

    # Verify extracted faces
    if not os.path.isdir(EXTRACTED_PATH):
        print(f"\nERROR: Extracted faces not found at {EXTRACTED_PATH}")
        print("Run extract_faces.py first.")
        sys.exit(1)

    # Init device, model, optimizer
    device = torch.device(DEVICE)
    print(f"\nDevice: {device}\n")

    print("Initializing CustomCNN (Path C)...")
    model = CustomCNN(embedding_dim=512).to(device)
    num_params = sum(p.numel() for p in model.parameters() if p.requires_grad)
    print(f"  Total parameters: {num_params:,} (~{num_params/1e6:.1f}M)\n")

    print("Loading VGGFace2 dataset...")
    dataloader, num_identities = create_dataloaders(BATCH_SIZE)
    print(f"  {num_identities:,} identities\n")

    # Classification head: Linear(512, num_identities), no bias, applied to
    # the L2-normalized embedding and scaled before softmax (standard
    # cosine-similarity classification, ArcFace/CosFace-style without the
    # angular margin term). Chosen over the triplet loss this pipeline
    # started with because triplet loss only constrains RELATIVE distances
    # (d(a,n) - d(a,p)) -- collapsing every embedding to the same point can
    # trivially satisfy whatever triplets get mined without learning
    # anything discriminative, and that's what happened in three separate
    # attempts (plain triplet, triplet + linear anti-collapse penalty,
    # triplet + squared anti-collapse penalty -- see TRAINING_LOG.md).
    # Cross-entropy classification doesn't have that degenerate optimum:
    # if all embeddings were identical, a single embedding could not
    # simultaneously classify correctly as up to 19,203 different
    # identities, so collapse is catastrophic for the loss, not
    # accidentally close to optimal.
    classifier = nn.Linear(512, num_identities, bias=False).to(device)
    SCALE = 30.0  # standard ArcFace/CosFace temperature; raw cosine sims
                  # are bounded in [-1,1], too narrow a range for useful
                  # cross-entropy gradients without it.

    # weight_decay=0: every conv here feeds directly into BatchNorm, which
    # makes the loss scale-invariant to those weights, so L2 decay has no
    # restoring force and silently collapses them toward zero over enough
    # steps. See CustomCNN docstring -- this exact bug killed a prior run.
    optimizer = optim.Adam(
        list(model.parameters()) + list(classifier.parameters()),
        lr=LEARNING_RATE, weight_decay=0)
    criterion = nn.CrossEntropyLoss()

    # Check for existing checkpoint
    latest_ckpt = os.path.join(CHECKPOINT_DIR, "latest.pt")
    start_epoch = 0

    if os.path.exists(latest_ckpt):
        print(f"\nFound checkpoint. Resuming...")
        start_epoch, _ = load_checkpoint(model, classifier, optimizer, latest_ckpt)
        print(f"  Resuming from epoch {start_epoch + 1}")
    else:
        print("\nStarting training from scratch.")

    # Cosine LR decay: 1e-4 -> 1e-6 over epochs 1-40. A flat LR makes good
    # early progress but tends to plateau once the model needs finer
    # adjustments than a fixed step size allows; decaying it lets later
    # epochs actually settle into a better solution instead of oscillating
    # around one. On resume, fast-forward via manual .step() calls rather
    # than constructing with last_epoch=start_epoch directly -- the latter
    # requires the optimizer's param_groups to already carry an
    # 'initial_lr' key from a previous scheduler, which a freshly
    # recreated optimizer doesn't have (raises KeyError otherwise).
    #
    # Epochs 41-60 (WARM_RESTART_EPOCH) get a SEPARATE, fresh cosine cycle
    # instead of continuing the same one: CosineAnnealingLR's formula is
    # periodic, so stepping it past its own T_max makes LR climb back up
    # toward the original 1e-4 rather than staying near the floor it
    # reached -- resuming the *same* scheduler object past epoch 40 would
    # silently undo the whole point of decaying it in the first place.
    if start_epoch >= WARM_RESTART_EPOCH:
        for g in optimizer.param_groups:
            g['lr'] = WARM_RESTART_LR
        scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(
            optimizer, T_max=NUM_EPOCHS - WARM_RESTART_EPOCH, eta_min=1e-6)
        for _ in range(start_epoch - WARM_RESTART_EPOCH):
            scheduler.step()
    else:
        scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(
            optimizer, T_max=WARM_RESTART_EPOCH, eta_min=1e-6)
        for _ in range(start_epoch):
            scheduler.step()

    # Training loop
    print(f"\n{'─'*60}")
    print(f"Training for {NUM_EPOCHS} epochs (epochs {start_epoch+1}-{NUM_EPOCHS})")
    print(f"{'─'*60}")

    best_loss = float('inf')
    probe_batch = build_collapse_probe(device)
    low_diversity_streak = 0

    for epoch in range(start_epoch + 1, NUM_EPOCHS + 1):
        epoch_start = time.time()
        train_loss, train_acc = train_step(
            model, classifier, dataloader, optimizer, criterion, device, SCALE)
        elapsed = time.time() - epoch_start
        probe_dist = check_collapse(model, probe_batch)
        current_lr = optimizer.param_groups[0]['lr']
        scheduler.step()

        # Save checkpoint every SAVE_INTERVAL epochs
        if epoch % SAVE_INTERVAL == 0:
            ckpt_path = os.path.join(CHECKPOINT_DIR, f"epoch_{epoch}.pt")
            save_checkpoint(model, classifier, optimizer, epoch, train_loss, ckpt_path)

            # Update latest symlink
            if os.path.islink(latest_ckpt) or not os.path.exists(latest_ckpt):
                if os.path.exists(latest_ckpt):
                    os.remove(latest_ckpt)
                os.symlink(ckpt_path, latest_ckpt)

        # Permanent milestones at round-number epochs -- never pruned.
        if epoch in (10, 20, 30, 40, 50, 60):
            milestone_path = os.path.join(CHECKPOINT_DIR, f"milestone_epoch_{epoch}.pt")
            save_milestone(model, classifier, epoch, train_loss, milestone_path)

        status = "NEW BEST!" if train_loss < best_loss else ""
        if train_loss < best_loss:
            best_loss = train_loss

        print(f"Epoch {epoch:3d}/{NUM_EPOCHS} | Loss: {train_loss:.4f} | "
              f"Acc: {train_acc*100:.2f}% | "
              f"Time: {elapsed/60:.1f}min | Best: {best_loss:.4f} {status} | "
              f"ProbeDist: {probe_dist:.4f} | LR: {current_lr:.2e}")

        # Different real identities should embed far apart. If they don't,
        # the embedding space has collapsed to a near-constant output --
        # abort now instead of burning hours on a dead model.
        if probe_dist < 0.02:
            low_diversity_streak += 1
        else:
            low_diversity_streak = 0
        if low_diversity_streak >= 2:
            print(f"\n{'!'*60}")
            print(f"ABORTING: embedding collapse detected (ProbeDist={probe_dist:.4f} "
                  f"for {low_diversity_streak} epochs in a row).")
            print("Different identities are embedding near-identically -- ")
            print("the model has stopped learning anything useful.")
            print(f"{'!'*60}\n")
            sys.exit(1)

    print(f"\n{'='*60}")
    print(f"Phase 1 training complete!")
    print(f"  Best loss: {best_loss:.4f}")
    print(f"{'='*60}")

    # Save final pre-trained model
    final_path = os.path.join(CHECKPOINT_DIR, "vggface2_pretrained.pt")
    torch.save(model.state_dict(), final_path)
    print(f"  Final model: {final_path}")


if __name__ == "__main__":
    main()
