from sklearn.datasets import fetch_lfw_people
import os, shutil

print("Copying LFW images to data/negative...")

src = os.path.join('lfw_home', 'lfw_home', 'lfw_funneled')
dst = os.path.join('data', 'negative')
os.makedirs(dst, exist_ok=True)

copied = 0
for person in os.listdir(src):
    person_path = os.path.join(src, person)
    if not os.path.isdir(person_path):
        continue
    for file in os.listdir(person_path):
        shutil.copy(os.path.join(person_path, file), os.path.join(dst, file))
        copied += 1

print(f"Done — {copied} images copied to '{dst}'")
