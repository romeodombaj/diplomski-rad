#!/usr/bin/env python3
"""
Quick, CPU-only sanity check of verification quality at an intermediate
checkpoint, run alongside active GPU training without touching it.

Not a proper evaluation (evaluate.py's batch_test does that later, with
more pairs and an ROC curve) -- this is a fast, cheap "is the trajectory
looking sane" signal: 10 same-person pairs (two different photos of the
user) vs 10 different-person pairs (user vs a stranger), using cosine
similarity between embeddings. Runs on CPU specifically so it can't
compete with the actively-training GPU process for compute.
"""
import os
import sys
import random
import torch
from PIL import Image
import torchvision.transforms.functional as TF

import train_vggface2 as t

CHECKPOINT = sys.argv[1] if len(sys.argv) > 1 else \
    "/home/b2/projects/zavrsni/face_recognition/training_checkpoints/milestone_epoch_10.pt"
POS_DIR = "/home/b2/projects/zavrsni/face_recognition/data/positive"
NEG_DIR = "/home/b2/projects/zavrsni/face_recognition/data/negative"
N_PAIRS = 10

device = torch.device("cpu")
model = t.CustomCNN(embedding_dim=512)
ckpt = torch.load(CHECKPOINT, map_location=device, weights_only=True)
model.load_state_dict(ckpt["model_state_dict"])
model.eval()
print(f"Loaded {CHECKPOINT} (epoch {ckpt['epoch']}, train loss {ckpt['loss']:.4f})")

pos_files = [os.path.join(POS_DIR, f) for f in os.listdir(POS_DIR)
             if f.lower().endswith((".jpg", ".jpeg", ".png"))]
neg_files = [os.path.join(NEG_DIR, f) for f in os.listdir(NEG_DIR)
             if f.lower().endswith((".jpg", ".jpeg", ".png"))]

random.seed(42)


def embed(path):
    img = Image.open(path).convert("RGB")
    img = TF.resize(img, (105, 105))
    img = TF.to_tensor(img)
    img = TF.normalize(img, mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
    with torch.no_grad():
        return model(img.unsqueeze(0))[0]


def cos_sim(a, b):
    return torch.dot(a, b).item()


same_sims = []
for _ in range(N_PAIRS):
    a, b = random.sample(pos_files, 2)
    same_sims.append(cos_sim(embed(a), embed(b)))

cross_sims = []
for _ in range(N_PAIRS):
    a = random.choice(pos_files)
    b = random.choice(neg_files)
    cross_sims.append(cos_sim(embed(a), embed(b)))

import statistics as stats
print(f"\nSame-person pairs   (n={N_PAIRS}): mean={stats.mean(same_sims):.4f}  "
      f"std={stats.stdev(same_sims):.4f}  min={min(same_sims):.4f}  max={max(same_sims):.4f}")
print(f"Different-person pairs (n={N_PAIRS}): mean={stats.mean(cross_sims):.4f}  "
      f"std={stats.stdev(cross_sims):.4f}  min={min(cross_sims):.4f}  max={max(cross_sims):.4f}")
print(f"\nSeparation (higher = better): {stats.mean(same_sims) - stats.mean(cross_sims):.4f}")

threshold = (stats.mean(same_sims) + stats.mean(cross_sims)) / 2
correct = sum(1 for s in same_sims if s > threshold) + sum(1 for s in cross_sims if s <= threshold)
print(f"Naive midpoint-threshold accuracy on these {N_PAIRS*2} pairs: {correct}/{N_PAIRS*2} ({correct/(N_PAIRS*2)*100:.0f}%)")
