"""
fine_tune.py
============
Phase 2: Fine-tune pre-trained custom CNN on personal data.

WHAT THIS DOES:
  Loads Phase 1 pre-trained weights and fine-tunes on your personal
  photos. The goal: teach the network to recognize YOU specifically.

HOW IT WORKS:
  1. Load Phase 1 pre-trained weights
  2. Freeze convolutional blocks (already know face features)
  3. Unfreeze final Dense layers (Dense(1024) -> Dense(512))
  4. Train on triplets:
     - Anchor: one of your photos
     - Positive: another photo of you
     - Negative: any stranger's face (from LFW dataset)
  5. Network learns to pull your photos together and push strangers away

WHY FINE-TUNING WORKS:
  Phase 1 learned "what makes faces different." Phase 2 learns
  "where YOU sit in that space." This is why 1K personal images
  are enough — you're not learning face features from scratch.

KEY CHANGES FROM PHASE 1:
  1. Lower learning rate (1e-4 vs 1e-3) — fine adjustments
  2. Frozen conv blocks — no need to relearn features
  3. Only train top Dense layers
  4. Personal data triplets

CHECKPOINTING:
  Saves every 10 epochs. Auto-resumes if interrupted.

USAGE:
  python fine_tune.py

FILES NEEDED:
  - Pre-trained weights: training_checkpoints/vggface2_pretrained.pt
  - Your photos: data/positive/ and data/negative/
"""

import os
import sys
import time
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader, Dataset
import torchvision.transforms.functional as TF
import numpy as np
from PIL import Image


PRETRAINED_PATH = "/home/b2/projects/zavrsni/face_recognition/training_checkpoints/vggface2_pretrained.pt"
POSITIVE_DIR = "/home/b2/projects/zavrsni/face_recognition/data/positive"
NEGATIVE_DIR = "/home/b2/projects/zavrsni/face_recognition/data/negative"

BATCH_SIZE = 32
NUM_EPOCHS = 50
LEARNING_RATE = 1e-4
MARGIN = 0.2
DROPOUT_RATE = 0.3
SAVE_INTERVAL = 10

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
FREEZE_CONV = True
FREEZE_DENSE = False

print(f"Device: {DEVICE}")
if torch.cuda.is_available():
    torch.backends.cudnn.enabled = False



class CustomCNN(nn.Module):
    """Custom CNN for face embedding (Path C architecture, ~97.5M params).
    IDENTICAL to the version in train_vggface2.py."""
    def __init__(self, embedding_dim=512):
        super(CustomCNN, self).__init__()
        c1, c2, c3, c4, c5, c6, fc1_dim = 224, 448, 576, 896, 1152, 3072, 4096

        self.block1 = nn.Sequential(
            nn.Conv2d(3, c1, kernel_size=11, stride=1, padding=0),
            nn.BatchNorm2d(c1), nn.ReLU(inplace=True),
            nn.MaxPool2d(2),
            nn.Conv2d(c1, c1, kernel_size=3, padding=1),
            nn.BatchNorm2d(c1), nn.ReLU(inplace=True),
        )

        self.block2 = nn.Sequential(
            nn.Conv2d(c1, c2, kernel_size=7, stride=1, padding=0),
            nn.BatchNorm2d(c2), nn.ReLU(inplace=True),
            nn.MaxPool2d(2),
            nn.Conv2d(c2, c2, kernel_size=3, padding=1),
            nn.BatchNorm2d(c2), nn.ReLU(inplace=True),
        )

        self.block3 = nn.Sequential(
            nn.Conv2d(c2, c3, kernel_size=5, stride=1, padding=0),
            nn.BatchNorm2d(c3), nn.ReLU(inplace=True),
            nn.MaxPool2d(2),
            nn.Conv2d(c3, c3, kernel_size=3, padding=1),
            nn.BatchNorm2d(c3), nn.ReLU(inplace=True),
        )
        self.res3 = nn.Conv2d(c3, c3, kernel_size=1)

        self.block4 = nn.Sequential(
            nn.Conv2d(c3, c4, kernel_size=3, stride=1, padding=0),
            nn.BatchNorm2d(c4), nn.ReLU(inplace=True),
            nn.MaxPool2d(2),
            nn.Conv2d(c4, c4, kernel_size=3, padding=1),
            nn.BatchNorm2d(c4), nn.ReLU(inplace=True),
        )
        self.res4 = nn.Conv2d(c4, c4, kernel_size=1)

        self.block5 = nn.Sequential(
            nn.Conv2d(c4, c5, kernel_size=3, stride=1, padding=0),
            nn.BatchNorm2d(c5), nn.ReLU(inplace=True),
            nn.Conv2d(c5, c5, kernel_size=3, padding=1),
            nn.BatchNorm2d(c5), nn.ReLU(inplace=True),
        )

        self.block6 = nn.Sequential(
            nn.Conv2d(c5, c6, kernel_size=3, stride=1, padding=1),
            nn.BatchNorm2d(c6), nn.ReLU(inplace=True),
        )

        self.flatten = nn.Flatten()
        self.fc1 = nn.Linear(c6, fc1_dim)
        self.dropout = nn.Dropout(DROPOUT_RATE)
        self.fc2 = nn.Linear(fc1_dim, embedding_dim)

    def forward(self, x):
        out = self.block1(x)
        out = self.block2(out)
        out = self.block3(out); out = out + self.res3(out)
        out = self.block4(out); out = out + self.res4(out)
        out = self.block5(out)
        out = self.block6(out)
        out = self.flatten(out)
        out = self.fc1(out)
        out = self.dropout(out)
        out = self.fc2(out)
        out = nn.functional.normalize(out, p=2, dim=1)
        return out



class PersonalDataset(Dataset):
    """
    Personal face dataset for fine-tuning.

    Loads from two directories:
    - positive/: Photos of you (for anchor and positive)
    - negative/: Photos of strangers (for negative)

    Each sample is a triplet: (anchor, positive, negative).
    Triplet construction is random — ensures diversity.
    """
    def __init__(self, positive_dir, negative_dir):
        self.positive_dir = positive_dir
        self.negative_dir = negative_dir
        self.positive_files = [
            f for f in os.listdir(positive_dir)
            if f.lower().endswith(('.jpg', '.jpeg', '.png'))
        ]
        self.negative_files = [
            f for f in os.listdir(negative_dir)
            if f.lower().endswith(('.jpg', '.jpeg', '.png'))
        ]
        print(f"[Dataset] Positive: {len(self.positive_files)}, Negative: {len(self.negative_files)}")

    def __len__(self):
        return len(self.positive_files)

    def _load_image(self, filepath):
        """Load and preprocess image to 105x105 tensor with ImageNet norm."""
        img = Image.open(filepath).convert('RGB')
        img = TF.resize(img, (105, 105))
        img = TF.to_tensor(img)
        img = TF.normalize(img, mean=[0.485, 0.456, 0.406],
                           std=[0.229, 0.224, 0.225])
        return img

    def __getitem__(self, idx):
        """Build and return a single triplet."""
        pos_idx = np.random.randint(0, len(self.positive_files))
        while pos_idx == idx and len(self.positive_files) > 1:
            pos_idx = np.random.randint(0, len(self.positive_files))

        neg_idx = np.random.randint(0, len(self.negative_files))

        return (self._load_image(os.path.join(self.positive_dir, self.positive_files[idx])),
                self._load_image(os.path.join(self.positive_dir, self.positive_files[pos_idx])),
                self._load_image(os.path.join(self.negative_dir, self.negative_files[neg_idx])))



class TripletLoss(nn.Module):
    """Simple triplet loss for fine-tuning.
    Uses random mining (not semi-hard) for stability on small datasets.
    Formula: max(d(a,p) - d(a,n) + margin, 0)
    """
    def __init__(self, margin=0.2):
        super(TripletLoss, self).__init__()
        self.margin = margin

    def forward(self, anchor, positive, negative):
        pos_dist = torch.sum((anchor - positive) ** 2, dim=1)
        neg_dist = torch.sum((anchor - negative) ** 2, dim=1)
        loss = torch.clamp(pos_dist - neg_dist + self.margin, min=0.0)
        return loss.mean()



def create_dataloader(pos_dir, neg_dir, batch_size=32):
    """Create DataLoader yielding triplets."""
    return DataLoader(
        PersonalDataset(pos_dir, neg_dir),
        batch_size=batch_size, num_workers=4, prefetch_factor=2,
        pin_memory=True, persistent_workers=True,
    )


def fine_tune_step(model, dataloader, optimizer, criterion, device):
    """One training step: forward on triplets -> loss -> backward -> update.
    Only trains unfrozen layers (typically Dense(1024) -> Dropout -> Dense(512)).
    """
    model.train()
    total_loss = 0.0
    count = 0

    for anchor, positive, negative in dataloader:
        anchor = anchor.to(device)
        positive = positive.to(device)
        negative = negative.to(device)

        optimizer.zero_grad()
        emb_a = model(anchor)
        emb_p = model(positive)
        emb_n = model(negative)

        loss = criterion(emb_a, emb_p, emb_n)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(
            [p for p in model.parameters() if p.requires_grad], max_norm=1.0
        )
        optimizer.step()

        total_loss += loss.item()
        count += 1

    return total_loss / count if count > 0 else 0.0



def main():
    print("=" * 60)
    print("  Phase 2: Fine-tune on Personal Data")
    print("=" * 60)
    print(f"  Model: CustomCNN pre-trained on VGGFace2")
    print(f"  Epochs: {NUM_EPOCHS}, Batch: {BATCH_SIZE}, LR: {LEARNING_RATE}")
    print(f"  Conv blocks: {'FROZEN' if FREEZE_CONV else 'TRAINABLE'}")
    print(f"  Dense layers: {'FROZEN' if FREEZE_DENSE else 'TRAINABLE'}")
    print("=" * 60)

    if not os.path.exists(PRETRAINED_PATH):
        print(f"\nERROR: Pre-trained model not found at {PRETRAINED_PATH}")
        print("Run train_vggface2.py first.")
        sys.exit(1)
    if not os.path.isdir(POSITIVE_DIR):
        print(f"\nERROR: Positive dir not found: {POSITIVE_DIR}")
        sys.exit(1)
    if not os.path.isdir(NEGATIVE_DIR):
        print(f"\nERROR: Negative dir not found: {NEGATIVE_DIR}")
        sys.exit(1)

    device = torch.device(DEVICE)
    print(f"\nDevice: {device}\n")

    print("Loading Phase 1 pre-trained model...")
    model = CustomCNN(embedding_dim=512)
    model.load_state_dict(
        torch.load(PRETRAINED_PATH, map_location=DEVICE, weights_only=True)
    )
    model = model.to(device)

    if FREEZE_CONV:
        for name, module in model.named_modules():
            if 'block' in name or 'res' in name:
                for param in module.parameters():
                    param.requires_grad = False
        print("  Conv blocks frozen")

    if not FREEZE_DENSE:
        for name, module in model.named_modules():
            if 'fc' in name or 'dropout' in name:
                for param in module.parameters():
                    param.requires_grad = True
        print("  Dense layers unfrozen for training")
    else:
        print("  WARNING: Dense layers frozen — no training will occur")
        sys.exit(0)

    trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    total = sum(p.numel() for p in model.parameters())
    print(f"\n  Trainable: {trainable:,} / {total:,} ({trainable/total*100:.1f}%)")

    optimizer = optim.Adam(
        [p for p in model.parameters() if p.requires_grad],
        lr=LEARNING_RATE, weight_decay=1e-4
    )
    criterion = TripletLoss(margin=MARGIN)

    print("\nLoading personal dataset...")
    dataloader = create_dataloader(POSITIVE_DIR, NEGATIVE_DIR, BATCH_SIZE)

    CHECKPOINT_DIR = "/home/b2/projects/zavrsni/face_recognition/training_checkpoints"
    latest_ckpt = os.path.join(CHECKPOINT_DIR, "fine_tune_latest.pt")
    start_epoch = 0

    if os.path.exists(latest_ckpt):
        print(f"\nFound checkpoint. Resuming...")
        ckpt = torch.load(latest_ckpt, map_location=DEVICE, weights_only=True)
        optimizer.load_state_dict(ckpt['optimizer_state_dict'])
        start_epoch = ckpt['epoch']
        print(f"  Resuming from epoch {start_epoch + 1}")
    else:
        print("\nStarting fine-tuning from pre-trained model.")

    print(f"\n{'─'*60}")
    print(f"Fine-tuning for {NUM_EPOCHS} epochs")
    print(f"{'─'*60}")

    best_loss = float('inf')

    for epoch in range(start_epoch + 1, NUM_EPOCHS + 1):
        t0 = time.time()
        loss = fine_tune_step(model, dataloader, optimizer, criterion, device)
        elapsed = time.time() - t0

        if epoch % SAVE_INTERVAL == 0:
            os.makedirs(CHECKPOINT_DIR, exist_ok=True)
            ckpt_path = os.path.join(CHECKPOINT_DIR, f"finetune_epoch_{epoch}.pt")
            torch.save({
                'epoch': epoch,
                'model_state_dict': model.state_dict(),
                'optimizer_state_dict': optimizer.state_dict(),
                'loss': loss,
            }, ckpt_path)
            if os.path.islink(latest_ckpt) or not os.path.exists(latest_ckpt):
                if os.path.exists(latest_ckpt):
                    os.remove(latest_ckpt)
                os.symlink(ckpt_path, latest_ckpt)

        status = "NEW BEST!" if loss < best_loss else ""
        if loss < best_loss:
            best_loss = loss

        print(f"Epoch {epoch:3d}/{NUM_EPOCHS} | Loss: {loss:.4f} | "
              f"Time: {elapsed/60:.1f}min | Best: {best_loss:.4f} {status}")

    print(f"\n{'='*60}")
    print(f"Phase 2 fine-tuning complete!")
    print(f"  Best loss: {best_loss:.4f}")
    print(f"{'='*60}")

    final_path = os.path.join(CHECKPOINT_DIR, "personal_finetuned.pt")
    torch.save(model.state_dict(), final_path)
    print(f"  Final model: {final_path}")
    print(f"\nNext: Run 'python evaluate.py' to test accuracy.")


if __name__ == "__main__":
    main()
