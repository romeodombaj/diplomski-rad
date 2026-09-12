"""
export_onnx.py
==============
Convert the trained CustomCNN face-embedding backbone from PyTorch to ONNX
so it can run on-device (phone) instead of on a server.

WHY ONNX:
  The .pt checkpoints are PyTorch-only, which means Python-only. Phones
  cannot run them. ONNX is a portable graph format that onnxruntime can
  execute natively on iOS/Android, so the face never leaves the device.

WHAT THIS PRODUCES:
  siamese_epoch50.onnx        fp32, numerically identical to the .pt
  siamese_epoch50_int8.onnx   dynamically quantized, smaller

WHICH CHECKPOINT:
  vggface2_pretrained_epoch50_best.pt -- epoch 50 is the best checkpoint on
  verification separation (0.5022), which is the metric that actually
  matters here. Epochs 57 and 60 have higher raw classification accuracy
  but WORSE separation -- see TRAINING_LOG.md. Do not "upgrade" this to
  epoch 60 because the number looks bigger.

CORRECTNESS NOTE:
  model.eval() is mandatory before export. This architecture is dense with
  BatchNorm and has a Dropout(0.3) before the embedding layer. Exporting in
  train() mode would bake in batch statistics and active dropout, producing
  a model that returns a different embedding for the same face every call.

USAGE:
  python export_onnx.py
"""

import os
import sys

import numpy as np
import torch
import onnx
import onnxruntime as ort

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from train_vggface2 import CustomCNN

HERE = os.path.dirname(os.path.abspath(__file__))
CHECKPOINT = os.path.join(HERE, "training_checkpoints",
                          "vggface2_pretrained_epoch50_best.pt")
OUT_FP32 = os.path.join(HERE, "siamese_epoch50.onnx")
OUT_INT8 = os.path.join(HERE, "siamese_epoch50_int8.onnx")

INPUT_SIZE = 105
EMBEDDING_DIM = 512
IMAGENET_MEAN = [0.485, 0.456, 0.406]
IMAGENET_STD = [0.229, 0.224, 0.225]


def mb(path):
    return os.path.getsize(path) / 1e6


def load_model():
    """Load the epoch-50 backbone in eval mode."""
    model = CustomCNN(embedding_dim=EMBEDDING_DIM)
    state = torch.load(CHECKPOINT, map_location="cpu", weights_only=True)
    model.load_state_dict(state)
    model.eval()
    n = sum(p.numel() for p in model.parameters())
    print(f"  loaded {os.path.basename(CHECKPOINT)}  ({n/1e6:.1f}M params)")
    return model


def export_fp32(model):
    """TorchScript-trace the model to an ONNX graph."""
    dummy = torch.randn(1, 3, INPUT_SIZE, INPUT_SIZE)
    torch.onnx.export(
        model, dummy, OUT_FP32,
        input_names=["image"],
        output_names=["embedding"],
        dynamic_axes={"image": {0: "batch"}, "embedding": {0: "batch"}},
        opset_version=17,
        do_constant_folding=True,
        dynamo=False,
    )
    onnx.checker.check_model(onnx.load(OUT_FP32))
    print(f"  wrote {os.path.basename(OUT_FP32)}  ({mb(OUT_FP32):.1f} MB)  checker OK")


def parity(model, onnx_path, n=8, label=""):
    """
    Compare PyTorch vs onnxruntime embeddings on the same random inputs.

    Cosine similarity is the number that matters: the app compares faces by
    embedding distance, so a conversion that preserves DIRECTION preserves
    the decision even if magnitudes drift slightly.
    """
    sess = ort.InferenceSession(onnx_path, providers=["CPUExecutionProvider"])
    x = torch.randn(n, 3, INPUT_SIZE, INPUT_SIZE)

    with torch.no_grad():
        ref = model(x).numpy()
    got = sess.run(["embedding"], {"image": x.numpy()})[0]

    max_abs = np.abs(ref - got).max()
    cos = (ref * got).sum(1) / (np.linalg.norm(ref, axis=1) * np.linalg.norm(got, axis=1))
    norms = np.linalg.norm(got, axis=1)

    print(f"  [{label}] max abs diff : {max_abs:.6f}")
    print(f"  [{label}] cosine sim   : min={cos.min():.6f}  mean={cos.mean():.6f}")
    print(f"  [{label}] output L2norm: min={norms.min():.4f} max={norms.max():.4f} (expect ~1.0)")
    return max_abs, cos.min()


def quantize(model):
    """
    Dynamic int8 quantization.

    Dynamic (rather than static) because it needs no calibration dataset.
    It quantizes Gemm/MatMul -- which here is fc1, by far the largest single
    weight in the model -- while leaving Conv in fp32. If the resulting size
    is still too large for the app, static quantization with a few hundred
    real face crops as calibration data is the next step and would also
    compress the conv stack.
    """
    from onnxruntime.quantization import quantize_dynamic, QuantType
    quantize_dynamic(OUT_FP32, OUT_INT8, weight_type=QuantType.QInt8)
    print(f"  wrote {os.path.basename(OUT_INT8)}  ({mb(OUT_INT8):.1f} MB)")


def main():
    if not os.path.exists(CHECKPOINT):
        sys.exit(f"checkpoint not found: {CHECKPOINT}")

    print("\n[1/4] load checkpoint")
    model = load_model()

    print("\n[2/4] export fp32 ONNX")
    export_fp32(model)

    print("\n[3/4] verify fp32 against PyTorch")
    parity(model, OUT_FP32, label="fp32")

    print("\n[4/4] quantize to int8 + verify")
    quantize(model)
    parity(model, OUT_INT8, label="int8")

    print("\nsizes:")
    print(f"  .pt   {mb(CHECKPOINT):7.1f} MB")
    print(f"  fp32  {mb(OUT_FP32):7.1f} MB")
    print(f"  int8  {mb(OUT_INT8):7.1f} MB")
    print("\npreprocessing the app MUST replicate:")
    print(f"  resize to {INPUT_SIZE}x{INPUT_SIZE}, scale to [0,1] (CHW, RGB),")
    print(f"  then normalize mean={IMAGENET_MEAN} std={IMAGENET_STD}")


if __name__ == "__main__":
    main()
