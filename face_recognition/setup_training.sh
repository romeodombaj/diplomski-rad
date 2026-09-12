#!/bin/bash

set -e

PROJECT_DIR="/home/b2/projects/zavrsni/face_recognition"
CHECKPOINT_DIR="$PROJECT_DIR/training_checkpoints"
LOG_DIR="/home/b2/projects/zavrsni/logs/face_recognition"

export ROCM_PATH=/opt/rocm-7.2.3
export HIP_PATH=/opt/rocm-7.2.3/hip
export LD_LIBRARY_PATH=/opt/rocm-7.2.3/lib:/opt/rocm-7.2.3/lib64:$LD_LIBRARY_PATH
export HIP_VISIBLE_DEVICES=0

echo "============================================="
echo "  Face Recognition Training Setup"
echo "============================================="

echo -n "Checking PyTorch... "
if python3 -c "import torch" 2>/dev/null; then
    echo "OK ($(python3 -c 'import torch; print(torch.__version__)'))"
else
    echo "FAIL - PyTorch not installed"
    echo "Run: pip3 install --break-system-packages torch torchvision torchaudio --index-url https://download.pytorch.org/whl/rocm7.2"
    exit 1
fi

echo -n "Checking GPU... "
GPU_AVAILABLE=$(python3 -c "import torch; print(torch.cuda.is_available())" 2>/dev/null)
if [ "$GPU_AVAILABLE" != "True" ]; then
    echo "FAIL"
    echo ""
    echo "GPU NOT DETECTED!"
    echo ""
    echo "This usually means the llamacpp Docker container is still holding VRAM."
    echo "Do one of the following:"
    echo ""
    echo "  1. Stop the container:"
    echo "     docker stop llama-cpp-35b-mtp"
    echo ""
    echo "  2. Or restart the container with less VRAM:"
    echo "     docker stop llama-cpp-35b-mtp"
    echo "     docker run --name llama-cpp-35b-mtp -p 8080:8080 -e GPU_ID=0 mixa3607/llama.cpp-gfx906:b10229-rocm-7.2.4-9fa3fef # without --gpus all"
    echo ""
    echo "After stopping the container, wait ~10 seconds for VRAM to release,"
    echo "then run this script again."
    echo ""
    echo "Verify VRAM is freed with:"
    echo "  rocm-smi --showmeminfo vram"
    exit 1
fi
echo "OK ($(python3 -c "import torch; print(f'{torch.cuda.get_device_name(0)} {torch.cuda.get_device_properties(0).total_memory / 1e9:.0f}GB')"))"

echo -n "Checking training data... "
if [ -d "$PROJECT_DIR/extracted_faces" ] && [ "$(ls -A $PROJECT_DIR/extracted_faces/ 2>/dev/null)" ]; then
    FACE_COUNT=$(find "$PROJECT_DIR/extracted_faces" -name "*.png" | wc -l)
    echo "OK ($FACE_COUNT faces)"
else
    echo "WARN - No extracted faces found"
    echo "Run: python3 extract_faces.py"
    echo "Then run this script again."
    exit 1
fi

echo ""
echo "============================================="
echo "  Checking checkpoints..."
echo "============================================="

PRETRAINED="$CHECKPOINT_DIR/vggface2_pretrained.pt"
FINETUNED="$CHECKPOINT_DIR/personal_finetuned.pt"

if [ -f "$FINETUNED" ]; then
    echo "Personal fine-tuned model exists!"
    echo "  This means training already completed successfully."
    echo ""
    echo "If you want to re-train, delete the checkpoint:"
    echo "  rm $FINETUNED"
    echo "  rm $CHECKPOINT_DIR/finetune_epoch_*.pt 2>/dev/null"
    echo ""
    echo "Otherwise, to evaluate your trained model:"
    echo "  python3 $PROJECT_DIR/evaluate.py"
    exit 0
elif [ -f "$PRETRAINED" ]; then
    echo "Phase 1 (pretraining) completed. Skipping to Phase 2 (fine-tuning)."
    PHASE="fine_tune"
else
    echo "No checkpoints found. Starting from Phase 1 (pretraining)."
    PHASE="train"
fi

echo ""
echo "============================================="
echo "  Starting Training"
echo "============================================="

mkdir -p "$LOG_DIR"

cd "$PROJECT_DIR"

if [ "$PHASE" = "fine_tune" ]; then
    echo "Running Phase 2: Fine-tuning on personal data..."
    python3 fine_tune.py 2>&1 | tee "$LOG_DIR/finetune.log"
else
    echo "Running Phase 1: Pretraining on VGGFace2..."
    python3 train_vggface2.py 2>&1 | tee "$LOG_DIR/pretrain.log"
    echo ""
    echo "Phase 1 complete! Running Phase 2..."
    python3 fine_tune.py 2>&1 | tee -a "$LOG_DIR/finetune.log"
fi

echo ""
echo "============================================="
echo "  Training Complete!"
echo "============================================="
echo ""
echo "Model saved to: $CHECKPOINT_DIR/personal_finetuned.pt"
echo "Logs saved to: $LOG_DIR/"
echo ""
echo "Next steps:"
echo "  1. Evaluate: python3 $PROJECT_DIR/evaluate.py"
echo "  2. Resume training (if interrupted): bash setup_training.sh"
echo "  3. Restart llamacpp: docker start llama-cpp-35b-mtp"
