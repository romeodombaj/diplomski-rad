"""
evaluate_lfw.py
===============
Benchmarks the trained face-embedding model on LFW (Labeled Faces in the
Wild) using the standard verification protocol, so the result is comparable
to published numbers instead of being a private metric.

THE PROTOCOL (this is the part that makes the number meaningful):
  LFW ships pairs.txt: 6000 face pairs split into 10 folds of 600
  (300 same-person + 300 different-person each). The model is never
  retrained -- it only produces embeddings. The decision threshold is the
  one free parameter, and it is fitted with 10-fold cross-validation:
  for each fold, the threshold that maximises accuracy on the OTHER NINE
  folds is chosen, then applied once to the held-out fold. The reported
  accuracy is the mean over the 10 held-out folds.

  This matters. Picking the single best threshold on all 6000 pairs and
  reporting the accuracy it gives is the most common way to accidentally
  overstate LFW performance -- that number is fitted on the test set. We
  report it too, as `oracle`, purely to show the size of that gap.

INPUT IMAGES:
  lfw_crops/ -- LFW put through the same MTCNN crop as the training data
  (see lfw_crop.py). Run that first. Use --images raw to instead feed the
  untouched 250x250 funneled frames, which measures how much the model
  depends on being given a tight face crop.

USAGE:
  python evaluate_lfw.py                         # all milestones + int8
  python evaluate_lfw.py --models siamese_epoch50.onnx
  python evaluate_lfw.py --images raw            # no-crop ablation
"""

import argparse
import json
import os
import sys
import time

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
LFW_RAW = os.path.join(HERE, "lfw_home", "lfw_home", "lfw_funneled")
LFW_CROPS = os.path.join(HERE, "lfw_crops")
PAIRS_FILE = os.path.join(HERE, "lfw_home", "lfw_home", "pairs.txt")
CACHE_DIR = os.path.join(HERE, "lfw_eval_cache")

INPUT_SIZE = 105                      # matches train_vggface2.py / export_onnx.py
IMAGENET_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
IMAGENET_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)
BATCH = 32


# ─── LFW pairs ───────────────────────────────────────────────────────────

def load_pairs():
    """
    Returns (pairs, labels, fold_id) for the canonical 6000-pair protocol.
    pairs[i] = (relpath_a, relpath_b); labels[i] = 1 same / 0 different.
    """
    with open(PAIRS_FILE) as fh:
        lines = [l for l in fh.read().split("\n")[1:] if l.strip()]
    assert len(lines) == 6000, f"expected 6000 pair lines, got {len(lines)}"

    def rel(name, idx):
        return f"{name}/{name}_{int(idx):04d}.jpg"

    pairs, labels, folds = [], [], []
    for i, line in enumerate(lines):
        p = line.split()
        if len(p) == 3:
            pairs.append((rel(p[0], p[1]), rel(p[0], p[2]))); labels.append(1)
        elif len(p) == 4:
            pairs.append((rel(p[0], p[1]), rel(p[2], p[3]))); labels.append(0)
        else:
            raise ValueError(f"bad pair line {i}: {line!r}")
        folds.append(i // 600)          # 10 folds of 600, in file order
    return pairs, np.array(labels), np.array(folds)


# ─── preprocessing ───────────────────────────────────────────────────────

def preprocess(path):
    """Resize to 105x105 + ImageNet normalise. Mirrors the eval transform
    in train_vggface2.py (bilinear resize, matching torchvision)."""
    img = Image.open(path).convert("RGB").resize(
        (INPUT_SIZE, INPUT_SIZE), Image.BILINEAR)
    a = np.asarray(img, dtype=np.float32) / 255.0
    a = (a - IMAGENET_MEAN) / IMAGENET_STD
    return a.transpose(2, 0, 1)                       # HWC -> CHW


# ─── model backends ──────────────────────────────────────────────────────

class OnnxModel:
    def __init__(self, path, threads):
        import onnxruntime as ort
        so = ort.SessionOptions()
        so.intra_op_num_threads = threads
        self.sess = ort.InferenceSession(
            path, so, providers=["CPUExecutionProvider"])
        self.iname = self.sess.get_inputs()[0].name

    def __call__(self, batch):
        return self.sess.run(None, {self.iname: batch})[0]


class TorchModel:
    def __init__(self, path, threads):
        import torch
        sys.path.insert(0, HERE)
        from train_vggface2 import CustomCNN
        torch.set_num_threads(threads)
        self.torch = torch
        state = torch.load(path, map_location="cpu", weights_only=False)
        # Milestones store {epoch, model_state_dict, ...}; the exported
        # backbones (vggface2_pretrained*.pt) are a bare state_dict.
        if isinstance(state, dict) and "model_state_dict" in state:
            state = state["model_state_dict"]
        self.model = CustomCNN(embedding_dim=512)
        self.model.load_state_dict(state)
        self.model.eval()

    def __call__(self, batch):
        with self.torch.no_grad():
            return self.model(self.torch.from_numpy(batch)).numpy()


def build_model(path, threads):
    return (OnnxModel if path.endswith(".onnx") else TorchModel)(path, threads)


# ─── embedding ───────────────────────────────────────────────────────────

def cache_tag(model_path, images):
    """
    Cache key. Derived from the checkpoint FILE, not the display name, so
    the same weights referenced two ways (default list vs --models path)
    hit the same cache instead of silently re-running an hour of inference.
    """
    return f"{os.path.splitext(os.path.basename(model_path))[0]}_{images}"


def embed_all(model, rel_paths, image_root, tag, threads):
    """Embed every unique image once; cache to disk keyed by model+imageset."""
    os.makedirs(CACHE_DIR, exist_ok=True)
    cache = os.path.join(CACHE_DIR, f"{tag}.npz")
    if os.path.exists(cache):
        z = np.load(cache, allow_pickle=True)
        if list(z["paths"]) == list(rel_paths):
            print(f"  embeddings loaded from cache ({tag}.npz)")
            return z["emb"]
        print(f"  cache {tag}.npz is for a different image set -- recomputing")

    embs = np.zeros((len(rel_paths), 512), dtype=np.float32)
    t0 = time.time()
    for s in range(0, len(rel_paths), BATCH):
        chunk = rel_paths[s:s + BATCH]
        batch = np.stack([preprocess(os.path.join(image_root, r))
                          for r in chunk])
        embs[s:s + len(chunk)] = model(batch)
        if (s // BATCH) % 40 == 0 and s:
            done, tot = s, len(rel_paths)
            rate = done / (time.time() - t0)
            print(f"    {done}/{tot}  {rate:.1f} img/s  "
                  f"eta {(tot-done)/rate/60:.1f} min", flush=True)
    print(f"  embedded {len(rel_paths)} images in "
          f"{(time.time()-t0)/60:.1f} min")

    # Embeddings are L2-normalised by the network's final layer; re-normalise
    # defensively so int8 rounding cannot make cosine != dot product.
    embs /= np.linalg.norm(embs, axis=1, keepdims=True) + 1e-12
    np.savez(cache, emb=embs, paths=np.array(rel_paths))
    return embs


# ─── metrics ─────────────────────────────────────────────────────────────

def best_threshold(scores, labels):
    """Threshold maximising accuracy, searched over the midpoints between
    consecutive observed scores (the only places accuracy can change)."""
    order = np.argsort(scores)
    s, y = scores[order], labels[order]
    n_pos = y.sum()
    # predicting "same" when score >= t; sweep t across every split point
    tp = n_pos - np.concatenate([[0], np.cumsum(y)])[:-1]
    tn = np.concatenate([[0], np.cumsum(1 - y)])[:-1]
    acc = (tp + tn) / len(y)
    k = int(np.argmax(acc))
    return float(s[k]), float(acc[k])


def accuracy_at(scores, labels, thr):
    pred = (scores >= thr).astype(int)
    return float((pred == labels).mean())


def tar_at_far(scores, labels, far_target):
    """True accept rate at a fixed false accept rate."""
    imp = np.sort(scores[labels == 0])[::-1]      # impostor scores, desc
    k = int(round(far_target * len(imp)))
    if k < 1:
        return 0.0, float(imp[0])
    thr = float(imp[k - 1])
    return float((scores[labels == 1] >= thr).mean()), thr


def roc_auc(scores, labels):
    """Rank-based (Mann-Whitney U) AUC -- exact, ties handled by mean rank."""
    order = np.argsort(scores, kind="mergesort")
    ranks = np.empty(len(scores), dtype=np.float64)
    ranks[order] = np.arange(1, len(scores) + 1)
    # average ranks within tied groups
    s = scores[order]
    i = 0
    while i < len(s):
        j = i
        while j + 1 < len(s) and s[j + 1] == s[i]:
            j += 1
        if j > i:
            ranks[order[i:j + 1]] = (i + j + 2) / 2.0
        i = j + 1
    n_pos = int(labels.sum())
    n_neg = len(labels) - n_pos
    return float((ranks[labels == 1].sum() - n_pos * (n_pos + 1) / 2.0)
                 / (n_pos * n_neg))


def roc_points(scores, labels):
    """(fpr, tpr) at every distinct threshold, thresholds descending."""
    order = np.argsort(-scores, kind="mergesort")
    y = labels[order]
    tp = np.cumsum(y)
    fp = np.cumsum(1 - y)
    keep = np.concatenate([np.diff(scores[order]) != 0, [True]])
    tpr = tp[keep] / max(1, labels.sum())
    fpr = fp[keep] / max(1, (1 - labels).sum())
    return fpr, tpr


def evaluate(scores, labels, folds):
    """Standard LFW 10-fold cross-validated accuracy + supporting metrics."""
    fold_acc, fold_thr = [], []
    for f in range(10):
        te = folds == f
        tr = ~te
        thr, _ = best_threshold(scores[tr], labels[tr])   # fitted on 9 folds
        fold_acc.append(accuracy_at(scores[te], labels[te], thr))  # tested on 1
        fold_thr.append(thr)

    acc = np.array(fold_acc)
    auc = roc_auc(scores, labels)
    fpr, tpr = roc_points(scores, labels)
    eer = float(fpr[np.nanargmin(np.abs(fpr - (1 - tpr)))])
    oracle_thr, oracle_acc = best_threshold(scores, labels)
    tar1, _ = tar_at_far(scores, labels, 0.01)
    tar01, _ = tar_at_far(scores, labels, 0.001)

    return {
        "accuracy_mean": float(acc.mean()),
        "accuracy_std": float(acc.std(ddof=1)),
        "accuracy_stderr": float(acc.std(ddof=1) / np.sqrt(10)),
        "fold_accuracies": [round(a, 4) for a in fold_acc],
        "fold_thresholds": [round(t, 4) for t in fold_thr],
        "threshold_mean": float(np.mean(fold_thr)),
        "auc": auc,
        "eer": eer,
        "tar_at_far_1pct": tar1,
        "tar_at_far_0.1pct": tar01,
        "oracle_accuracy": oracle_acc,
        "oracle_threshold": oracle_thr,
        "mean_sim_same": float(scores[labels == 1].mean()),
        "mean_sim_diff": float(scores[labels == 0].mean()),
    }


# ─── main ────────────────────────────────────────────────────────────────

DEFAULT_MODELS = [
    ("epoch10", "training_checkpoints/milestone_epoch_10.pt"),
    ("epoch20", "training_checkpoints/milestone_epoch_20.pt"),
    ("epoch30", "training_checkpoints/milestone_epoch_30.pt"),
    ("epoch40", "training_checkpoints/milestone_epoch_40.pt"),
    ("epoch50", "training_checkpoints/milestone_epoch_50.pt"),
    ("epoch60", "training_checkpoints/milestone_epoch_60.pt"),
    ("epoch50_int8_onnx", "siamese_epoch50_int8.onnx"),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", nargs="*", default=None,
                    help="checkpoint/onnx paths (default: all milestones)")
    ap.add_argument("--images", choices=["crops", "raw"], default="crops",
                    help="crops = MTCNN-cropped like training data (default)")
    ap.add_argument("--threads", type=int, default=16)
    ap.add_argument("--out", default="lfw_results.json")
    args = ap.parse_args()

    image_root = LFW_CROPS if args.images == "crops" else LFW_RAW
    if args.images == "crops" and not os.path.isdir(image_root):
        sys.exit("lfw_crops/ missing -- run: python lfw_crop.py")

    pairs, labels, folds = load_pairs()
    uniq = sorted({p for pair in pairs for p in pair})
    index = {p: i for i, p in enumerate(uniq)}
    ia = np.array([index[a] for a, _ in pairs])
    ib = np.array([index[b] for _, b in pairs])

    print(f"LFW protocol: {len(pairs)} pairs, {labels.sum()} same / "
          f"{(1-labels).sum()} different, {len(uniq)} unique images")
    print(f"Images: {args.images} ({image_root})\n")

    models = ([(os.path.basename(m).split(".")[0], m) for m in args.models]
              if args.models else DEFAULT_MODELS)

    results = {}
    for name, path in models:
        full = path if os.path.isabs(path) else os.path.join(HERE, path)
        if not os.path.exists(full):
            print(f"[skip] {name}: not found ({path})")
            continue
        print(f"── {name}  ({os.path.basename(path)})")
        model = build_model(full, args.threads)
        emb = embed_all(model, uniq, image_root,
                        cache_tag(path, args.images), args.threads)
        scores = np.sum(emb[ia] * emb[ib], axis=1)      # cosine similarity
        r = evaluate(scores, labels, folds)
        results[name] = dict(r, model_path=path, images=args.images)
        print(f"  LFW accuracy: {100*r['accuracy_mean']:.2f}% "
              f"+/- {100*r['accuracy_stderr']:.2f}   AUC {r['auc']:.4f}   "
              f"thr {r['threshold_mean']:.3f}\n", flush=True)
        del model

    out = os.path.join(HERE, args.out)
    with open(out, "w") as fh:
        json.dump(results, fh, indent=2)

    print("=" * 78)
    print(f"{'model':22s} {'LFW acc (10-fold)':>20s} {'AUC':>8s} "
          f"{'TAR@1%FAR':>10s} {'thr':>7s}")
    print("─" * 78)
    for name, r in results.items():
        print(f"{name:22s} {100*r['accuracy_mean']:12.2f}% "
              f"+/- {100*r['accuracy_stderr']:.2f} {r['auc']:8.4f} "
              f"{100*r['tar_at_far_1pct']:9.1f}% {r['threshold_mean']:7.3f}")
    print("=" * 78)
    print(f"\nresults -> {out}")


if __name__ == "__main__":
    main()
