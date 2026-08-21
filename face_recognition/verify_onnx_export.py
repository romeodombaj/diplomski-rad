"""Verify exported ONNX models on REAL faces, not random noise."""
import os, sys, numpy as np, torch, onnxruntime as ort
from PIL import Image
HERE = "/home/romeodombaj/fax/diplomski-rad/face_recognition"
sys.path.insert(0, HERE)
from train_vggface2 import CustomCNN

MEAN = np.array([0.485,0.456,0.406], np.float32).reshape(3,1,1)
STD  = np.array([0.229,0.224,0.225], np.float32).reshape(3,1,1)

def prep(p):
    img = Image.open(p).convert("RGB").resize((105,105), Image.BILINEAR)
    a = np.asarray(img, np.float32).transpose(2,0,1) / 255.0
    return (a - MEAN) / STD

def batch(d, n):
    fs = sorted(os.listdir(d))[:n]
    return np.stack([prep(os.path.join(d,f)) for f in fs])

N = 60
anc = batch(f"{HERE}/data/anchor",   N)
pos = batch(f"{HERE}/data/positive", N)
neg = batch(f"{HERE}/data/negative", N)
print(f"loaded {N} anchor / {N} positive / {N} negative real faces\n")

model = CustomCNN(embedding_dim=512)
model.load_state_dict(torch.load(f"{HERE}/training_checkpoints/vggface2_pretrained_epoch50_best.pt",
                                 map_location="cpu", weights_only=True))
model.eval()

def emb_torch(x):
    with torch.no_grad(): return model(torch.from_numpy(x)).numpy()
def emb_onnx(path, x):
    s = ort.InferenceSession(path, providers=["CPUExecutionProvider"])
    return s.run(["embedding"], {"image": x})[0]

backends = {
    "pytorch": lambda x: emb_torch(x),
    "onnx fp32": lambda x: emb_onnx(f"{HERE}/siamese_epoch50.onnx", x),
    "onnx int8": lambda x: emb_onnx(f"{HERE}/siamese_epoch50_int8.onnx", x),
}
print(f"{'backend':10s} {'same-person d':>14s} {'diff-person d':>14s} {'separation':>11s}")
print("-"*54)
res={}
for name, fn in backends.items():
    ea, ep, en = fn(anc), fn(pos), fn(neg)
    d_same = np.linalg.norm(ea-ep, axis=1)
    d_diff = np.linalg.norm(ea-en, axis=1)
    sep = d_diff.mean() - d_same.mean()
    res[name]=(ea,d_same,d_diff)
    print(f"{name:10s} {d_same.mean():8.4f}±{d_same.std():.3f} {d_diff.mean():8.4f}±{d_diff.std():.3f} {sep:11.4f}")

print("\nagreement with pytorch (cosine sim of embeddings on same images):")
base = res["pytorch"][0]
for name in ["onnx fp32","onnx int8"]:
    e = res[name][0]
    cos = (base*e).sum(1)/(np.linalg.norm(base,axis=1)*np.linalg.norm(e,axis=1))
    print(f"  {name}: min={cos.min():.6f} mean={cos.mean():.6f}")

d_same, d_diff = res["onnx int8"][1], res["onnx int8"][2]
best_t, best_acc = 0, 0
for t in np.arange(0.1, 2.0, 0.01):
    acc = ((d_same < t).sum() + (d_diff >= t).sum()) / (2*N)
    if acc > best_acc: best_acc, best_t = acc, t
print(f"\nint8 best threshold {best_t:.2f} -> accuracy {best_acc*100:.1f}% on this sample")
