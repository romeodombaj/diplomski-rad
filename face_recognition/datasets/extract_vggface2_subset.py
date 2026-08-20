#!/usr/bin/env python3
"""Stream-extract a disk-budget-capped subset of VGGFace2 straight into
extracted_faces/, merged alongside the existing CASIA-WebFace identities.

Disk is tight (~16GB free after the 36GB tar download), so this doesn't
extract the full ~40-50GB raw dataset. Instead it streams the tar (single
pass, no full extraction to a temp dir) and takes up to MAX_PER_IDENTITY
images per identity, stopping hard once TOTAL_BYTES_CAP is written -
enough to meaningfully broaden identity diversity (up to ~9,131 more
identities) without risking filling the disk.

VGGFace2 identities are prefixed 'vgg2_<n_id>' so they can't collide with
CASIA-WebFace's plain-integer identity folder names already in
extracted_faces/.
"""
import os
import tarfile

TAR_PATH = "/home/b2/projects/zavrsni/face_recognition/datasets/vggface2/VGG-Face2/data/vggface2_train.tar.gz"
OUTPUT_DIR = "/home/b2/projects/zavrsni/face_recognition/extracted_faces"

MAX_PER_IDENTITY = 30
TOTAL_BYTES_CAP = 8 * 1024**3  # 8 GB hard stop, leaves headroom on a 16GB-free disk

os.makedirs(OUTPUT_DIR, exist_ok=True)

per_identity_count = {}
total_bytes = 0
total_images = 0
identities_seen = set()

with tarfile.open(TAR_PATH, "r|gz") as tf:
    for member in tf:
        if not member.isfile() or not member.name.endswith(".jpg"):
            continue
        parts = member.name.split("/")
        if len(parts) != 3:
            continue
        _, raw_id, fname = parts
        out_identity = f"vgg2_{raw_id}"

        if per_identity_count.get(out_identity, 0) >= MAX_PER_IDENTITY:
            continue

        if total_bytes + member.size > TOTAL_BYTES_CAP:
            print(f"Hit {TOTAL_BYTES_CAP/1e9:.1f}GB budget cap, stopping.", flush=True)
            break

        src = tf.extractfile(member)
        if src is None:
            continue
        data = src.read()

        out_dir = os.path.join(OUTPUT_DIR, out_identity)
        os.makedirs(out_dir, exist_ok=True)
        with open(os.path.join(out_dir, fname), "wb") as f:
            f.write(data)

        per_identity_count[out_identity] = per_identity_count.get(out_identity, 0) + 1
        identities_seen.add(out_identity)
        total_bytes += member.size
        total_images += 1

        if total_images % 5000 == 0:
            print(
                f"Extracted {total_images:,} images, {len(identities_seen):,} identities, "
                f"{total_bytes/1e9:.2f} GB",
                flush=True,
            )

print("EXTRACTION COMPLETE", flush=True)
print(f"Total images: {total_images:,}", flush=True)
print(f"Total identities: {len(identities_seen):,}", flush=True)
print(f"Total bytes: {total_bytes/1e9:.2f} GB", flush=True)
