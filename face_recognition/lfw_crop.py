"""
lfw_crop.py
===========
Prepares the LFW benchmark images so they look like the images the model was
actually trained on.

WHY THIS EXISTS:
  The model was pretrained on VGGFace2 faces that went through
  extract_faces.py: MTCNN detects the face, the box is padded by 15% of its
  longer side, and the crop is resized to 112x112. LFW "funneled" images are
  250x250 frames where the face occupies only the middle ~40% -- feeding
  those in raw would test the model on a framing it has never seen and
  understate its accuracy. So we run LFW through the *same* crop.

  extract_faces.py uses the TensorFlow `mtcnn` package; that pipeline ran on
  the training machine. Here we use facenet-pytorch's MTCNN -- the same
  network, a different implementation -- because this machine has torch but
  no TensorFlow. Box coordinates differ only marginally between the two.

FALLBACK:
  MTCNN misses a face on a small number of LFW images. Those are NOT dropped
  (dropping them would quietly make the benchmark easier and no longer the
  standard 6000-pair protocol). They fall back to a fixed center crop sized
  to match the median detected box, and the count is reported.

OUTPUT: lfw_crops/<Person_Name>/<Person_Name>_NNNN.jpg  (112x112)
        lfw_crops/_manifest.json  (which images used the fallback)
"""

import json
import os
import sys
from multiprocessing import Pool

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
LFW_ROOT = os.path.join(HERE, "lfw_home", "lfw_home", "lfw_funneled")
PAIRS_FILE = os.path.join(HERE, "lfw_home", "lfw_home", "pairs.txt")
OUT_ROOT = os.path.join(HERE, "lfw_crops")

CROP_SIZE = 112
MARGIN_FRAC = 0.15

FALLBACK_BOX = 150

_detector = None


def get_detector():
    """One MTCNN per worker process (not picklable, so built lazily)."""
    global _detector
    if _detector is None:
        import torch
        from facenet_pytorch import MTCNN
        torch.set_num_threads(1)
        _detector = MTCNN(keep_all=True, device="cpu")
    return _detector


def crop_one(rel_path):
    """
    Returns (rel_path, used_fallback). Writes the 112x112 crop to OUT_ROOT.
    """
    src = os.path.join(LFW_ROOT, rel_path)
    dst = os.path.join(OUT_ROOT, rel_path)
    if os.path.exists(dst):
        return rel_path, None

    img = Image.open(src).convert("RGB")
    boxes, probs = get_detector().detect(img)

    used_fallback = False
    if boxes is None or len(boxes) == 0:
        used_fallback = True
        cx, cy = img.width / 2, img.height / 2
        h = FALLBACK_BOX / 2
        x1, y1, x2, y2 = cx - h, cy - h, cx + h, cy + h
    else:
        areas = [(b[2] - b[0]) * (b[3] - b[1]) for b in boxes]
        x1, y1, x2, y2 = boxes[int(np.argmax(areas))]
        w, h = x2 - x1, y2 - y1
        margin = max(w, h) * MARGIN_FRAC
        x1, y1, x2, y2 = x1 - margin, y1 - margin, x2 + margin, y2 + margin

    x1 = max(0, int(round(x1)));           y1 = max(0, int(round(y1)))
    x2 = min(img.width, int(round(x2)));   y2 = min(img.height, int(round(y2)))

    face = img.crop((x1, y1, x2, y2)).resize((CROP_SIZE, CROP_SIZE),
                                             Image.LANCZOS)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    face.save(dst, quality=95)
    return rel_path, used_fallback


def images_in_pairs():
    """Every unique image referenced by the standard 6000-pair protocol."""
    needed = set()
    with open(PAIRS_FILE) as fh:
        lines = fh.read().split("\n")
    for line in lines[1:]:
        p = line.split()
        if len(p) == 3:
            needed.add((p[0], int(p[1])))
            needed.add((p[0], int(p[2])))
        elif len(p) == 4:
            needed.add((p[0], int(p[1])))
            needed.add((p[2], int(p[3])))
    return sorted(f"{n}/{n}_{i:04d}.jpg" for n, i in needed)


def main():
    rels = images_in_pairs()
    print(f"LFW pairs protocol references {len(rels)} unique images")
    todo = [r for r in rels
            if not os.path.exists(os.path.join(OUT_ROOT, r))]
    print(f"{len(rels) - len(todo)} already cached, {len(todo)} to crop")

    fallbacks = []
    if todo:
        with Pool(processes=int(os.environ.get("NPROC", 12))) as pool:
            for k, (rel, fb) in enumerate(
                    pool.imap_unordered(crop_one, todo, chunksize=16), 1):
                if fb:
                    fallbacks.append(rel)
                if k % 500 == 0 or k == len(todo):
                    print(f"  {k}/{len(todo)}  (fallbacks so far: "
                          f"{len(fallbacks)})", flush=True)

    manifest = {
        "total_images": len(rels),
        "crop_size": CROP_SIZE,
        "margin_frac": MARGIN_FRAC,
        "detector": "facenet-pytorch MTCNN (largest face)",
        "fallback_center_crop_px": FALLBACK_BOX,
        "fallback_images": sorted(fallbacks),
        "fallback_count": len(fallbacks),
    }
    with open(os.path.join(OUT_ROOT, "_manifest.json"), "w") as fh:
        json.dump(manifest, fh, indent=2)

    print(f"\nDone. {len(rels)} crops in {OUT_ROOT}")
    print(f"MTCNN detection failed on {len(fallbacks)} image(s) "
          f"({100*len(fallbacks)/max(1,len(rels)):.2f}%) -> center-crop fallback")


if __name__ == "__main__":
    main()
