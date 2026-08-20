#!/usr/bin/env python3
"""Convert CASIA-WebFace MXNet RecordIO (train.rec/train.idx) to a
per-identity image directory tree, using only OpenCV + struct (no mxnet
dependency).

Record layout (verified against the actual downloaded file):
  - train.idx: one "<key>\t<byte_offset>" line per record, offset points
    into train.rec at the start of that record's low-level dmlc framing.
  - Low-level framing at each offset: 4-byte magic (0xced7230a) + 4-byte
    lrecord (low 29 bits = data length, top 3 bits = chunk flag) + data,
    padded to 4-byte alignment.
  - Inner data = 24-byte IRHeader ('<IfQQ' = flag, label, id, id2)
    [+ flag*4 bytes of extra float labels if flag>0] + JPEG-encoded image.

CASIA-WebFace here is already aligned/cropped to 112x112, so no MTCNN
face-extraction step is needed — the images are used as-is.
"""
import os
import cv2
import struct
import numpy as np

DATA_ROOT = "/home/b2/projects/zavrsni/face_recognition/datasets/casia-webface"
OUTPUT_DIR = "/home/b2/projects/zavrsni/face_recognition/extracted_faces"

MAGIC = 0xCED7230A
LENGTH_MASK = (1 << 29) - 1
HEADER_FMT = "<IfQQ"
HEADER_SIZE = struct.calcsize(HEADER_FMT)


def convert():
    idx_path = os.path.join(DATA_ROOT, "train.idx")
    rec_path = os.path.join(DATA_ROOT, "train.rec")

    print(f"Loading index from {idx_path}...")
    entries = []
    with open(idx_path, "r") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            key, offset = line.split("\t")
            entries.append(int(offset))

    print(f"Found {len(entries):,} records")
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    count = 0
    skipped = 0

    with open(rec_path, "rb") as f:
        for offset in entries:
            f.seek(offset)
            head = f.read(8)
            if len(head) < 8:
                skipped += 1
                continue

            magic, lrecord = struct.unpack("<II", head)
            if magic != MAGIC:
                skipped += 1
                continue

            length = lrecord & LENGTH_MASK
            data = f.read(length)
            if len(data) < HEADER_SIZE:
                skipped += 1
                continue

            flag, label, id1, id2 = struct.unpack(HEADER_FMT, data[:HEADER_SIZE])
            img_bytes = data[HEADER_SIZE + flag * 4:]

            if len(img_bytes) == 0:
                # Non-image records (e.g. dataset metadata/boundary entries)
                skipped += 1
                continue

            try:
                img = cv2.imdecode(np.frombuffer(img_bytes, dtype=np.uint8), cv2.IMREAD_COLOR)
            except cv2.error:
                img = None
            if img is None:
                skipped += 1
                continue

            class_id = str(int(label))
            cls_dir = os.path.join(OUTPUT_DIR, class_id)
            os.makedirs(cls_dir, exist_ok=True)

            img_path = os.path.join(cls_dir, f"{count:06d}.jpg")
            cv2.imwrite(img_path, img)
            count += 1

            if count % 20000 == 0:
                print(f"Processed: {count:,} images, {skipped} skipped")

    print("Conversion complete!")
    print(f"Total images: {count:,}")
    print(f"Skipped: {skipped}")
    print(f"Output directory: {OUTPUT_DIR}")
    print(f"Classes: {len(os.listdir(OUTPUT_DIR)):,}")


if __name__ == "__main__":
    convert()
