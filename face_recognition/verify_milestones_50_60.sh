#!/bin/bash
cd /home/b2/projects/zavrsni/face_recognition
for epoch in 50 60; do
  ckpt="training_checkpoints/milestone_epoch_${epoch}.pt"
  while [ ! -f "$ckpt" ]; do sleep 30; done
  sleep 5
  echo "=== MILESTONE_CHECK epoch ${epoch} ==="
  python3 quick_verify_check.py "$ckpt" 2>&1 | grep -v "hipBLASLt\|conv.py:549\|Device:\|GPU:\|VRAM:"
  echo "=== END_MILESTONE_CHECK epoch ${epoch} ==="
done
echo "=== PHASE1_EXTENSION_FULLY_DONE ==="
