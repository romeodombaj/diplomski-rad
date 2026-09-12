"""
extract_faces.py
================
Extracts faces from VGGFace2 raw images using MTCNN.

WHAT THIS DOES:
  VGGFace2 contains full-face or full-body images (many different sizes).
  We need to detect each face, crop it to 112x112, and save it in a
  structured directory tree for training.

PROCESS:
  1. Scan VGGFace2 image files
  2. For each image: run MTCNN face detector
  3. Take the largest detected face (most likely the main subject)
  4. Crop + resize to 112x112
  5. Save as .png in mirrored directory: extracted_faces/ID_XXXX/face_XXXX.png

REASON FOR THIS STEP:
  Training on full photos produces terrible results. The network needs
  clean, centered face crops to learn facial features. MTCNN is one of
  the best open-source face detectors.

INPUT: VGGFace2 raw images (downloaded from GDrive)
OUTPUT: extracted_faces/ directory with 112x112 face crops

USAGE:
  python extract_faces.py
"""

import os
import sys
import time
import numpy as np
from mtcnn import MTCNN
from PIL import Image

VGGFACE2_PATH = "/home/b2/projects/zavrsni/face_recognition/VGGFace2"

EXTRACTED_PATH = "/home/b2/projects/zavrsni/face_recognition/extracted_faces"

print("Initializing MTCNN face detector...")
detector = MTCNN()
print("MTCNN ready.\n")


def extract_face(img_pil, detector):
    """
    Run MTCNN on a PIL image and return the largest detected face.

    MTCNN returns multiple face bounding boxes. We take the largest
    box (highest area) as the primary face, then crop and resize to 112x112.
    """
    try:
        results = detector.detect_faces(img_pil)
        if not results:
            return None

        best = max(results, key=lambda d: d['box'][2] * d['box'][3])
        x, y, w, h = best['box']

        margin = int(max(w, h) * 0.15)
        x1 = max(0, x - margin)
        y1 = max(0, y - margin)
        x2 = min(img_pil.width, x + w + margin)
        y2 = min(img_pil.height, y + h + margin)

        face_crop = img_pil.crop((x1, y1, x2, y2))
        face_crop = face_crop.resize((112, 112), Image.LANCZOS)
        return face_crop

    except Exception as e:
        return None


def process_vggface2(vgg_path, out_path):
    """
    Walk through VGGFace2 directory structure and extract faces.

    VGGFace2 layout:
        VGGFace2/
        ├── ID_0001/
        │   ├── ID_0001_0001.jpg
        │   └── ...
        └── ID_0002/
            └── ...

    OUTPUT:
        extracted_faces/
        ├── ID_0001/
        │   ├── face_0001.png
        │   └── ...
        └── ...
    """
    print(f"Scanning VGGFace2 at: {vgg_path}")
    print(f"Saving extracted faces to: {out_path}\n")

    if not os.path.isdir(vgg_path):
        print(f"ERROR: VGGFace2 directory not found at {vgg_path}")
        print("Extract the VGGFace2 dataset first, then set VGGFACE2_PATH.")
        sys.exit(1)

    ids = [d for d in os.listdir(vgg_path) if os.path.isdir(os.path.join(vgg_path, d))]
    print(f"Found {len(ids)} identity directories in VGGFace2.\n")

    extracted_count = 0
    skipped_count = 0
    start_time = time.time()

    for id_dir in ids:
        id_path = os.path.join(vgg_path, id_dir)
        out_id_dir = os.path.join(out_path, id_dir)
        os.makedirs(out_id_dir, exist_ok=True)

        img_files = sorted([f for f in os.listdir(id_path)
                            if f.endswith(('.jpg', '.png', '.JPEG', '.JPG'))])

        for img_file in img_files:
            img_path = os.path.join(id_path, img_file)
            face = extract_face(Image.open(img_path), detector)

            if face is not None:
                save_path = os.path.join(out_id_dir,
                                         os.path.splitext(img_file)[0] + ".png")
                face.save(save_path)
                extracted_count += 1
            else:
                skipped_count += 1

            if extracted_count % 1000 == 0:
                elapsed = time.time() - start_time
                rate = extracted_count / elapsed if elapsed > 0 else 0
                print(f"  Extracted: {extracted_count:>8,} images  "
                      f"({rate:.1f} images/sec, {elapsed/60:.1f} min elapsed)")

    elapsed = time.time() - start_time
    print(f"\n{'='*60}")
    print(f"Face extraction complete!")
    print(f"  Extracted: {extracted_count:,} faces")
    print(f"  Skipped:   {skipped_count:,} images (no face detected)")
    print(f"  Total time: {elapsed/60:.1f} minutes")
    print(f"{'='*60}")


def main():
    os.makedirs(EXTRACTED_PATH, exist_ok=True)
    process_vggface2(VGGFACE2_PATH, EXTRACTED_PATH)


if __name__ == "__main__":
    main()
