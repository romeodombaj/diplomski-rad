"""
evaluate.py
===========
Evaluates the fine-tuned face recognition model.

WHAT THIS DOES:
  1. Provides an interactive webcam verification loop
  2. Compares embedding distances for same/different person pairs
  3. Runs a batch test over the personal positive/negative directories

WHAT THIS DOES *NOT* DO:
  Despite an earlier version of this docstring, it has never tested on LFW.
  The LFW benchmark lives in evaluate_lfw.py (standard 6000-pair, 10-fold
  protocol); run lfw_crop.py first. See TRAINING_LOG.md section 26.

  The paths below are also hardcoded to the /home/b2 training machine and
  need editing before this script will run anywhere else.

FILES NEEDED:
  - Personal fine-tuned model: training_checkpoints/personal_finetuned.pt
"""

import os
import sys
import torch
import torch.nn as nn
import numpy as np
import cv2
from PIL import Image
import torchvision.transforms.functional as TF
import matplotlib.pyplot as plt
from sklearn.metrics import roc_curve, auc


# ─── CUSTOM CNN (same architecture as training) ──────────────────────────

class CustomCNN(nn.Module):
    """
    Custom CNN for face embedding (Path C architecture).
    IDENTICAL to the version used in training.
    """
    def __init__(self, embedding_dim=512):
        super(CustomCNN, self).__init__()
        c1, c2, c3, c4, c5, c6, fc1_dim = 224, 448, 576, 896, 1152, 3072, 4096
        self.block1 = nn.Sequential(
            nn.Conv2d(3, c1, kernel_size=11, stride=1, padding=0),
            nn.BatchNorm2d(c1), nn.ReLU(inplace=True),
            nn.MaxPool2d(kernel_size=2, stride=2),
            nn.Conv2d(c1, c1, kernel_size=3, padding=1),
            nn.BatchNorm2d(c1), nn.ReLU(inplace=True),
        )
        self.block2 = nn.Sequential(
            nn.Conv2d(c1, c2, kernel_size=7, stride=1, padding=0),
            nn.BatchNorm2d(c2), nn.ReLU(inplace=True),
            nn.MaxPool2d(kernel_size=2, stride=2),
            nn.Conv2d(c2, c2, kernel_size=3, padding=1),
            nn.BatchNorm2d(c2), nn.ReLU(inplace=True),
        )
        self.block3 = nn.Sequential(
            nn.Conv2d(c2, c3, kernel_size=5, stride=1, padding=0),
            nn.BatchNorm2d(c3), nn.ReLU(inplace=True),
            nn.MaxPool2d(kernel_size=2, stride=2),
            nn.Conv2d(c3, c3, kernel_size=3, padding=1),
            nn.BatchNorm2d(c3), nn.ReLU(inplace=True),
        )
        self.res3 = nn.Conv2d(c3, c3, kernel_size=1)
        self.block4 = nn.Sequential(
            nn.Conv2d(c3, c4, kernel_size=3, stride=1, padding=0),
            nn.BatchNorm2d(c4), nn.ReLU(inplace=True),
            nn.MaxPool2d(kernel_size=2, stride=2),
            nn.Conv2d(c4, c4, kernel_size=3, padding=1),
            nn.BatchNorm2d(c4), nn.ReLU(inplace=True),
        )
        self.res4 = nn.Conv2d(c4, c4, kernel_size=1)
        self.block5 = nn.Sequential(
            nn.Conv2d(c4, c5, kernel_size=3, stride=1, padding=0),
            nn.BatchNorm2d(c5), nn.ReLU(inplace=True),
            nn.Conv2d(c5, c5, kernel_size=3, padding=1),
            nn.BatchNorm2d(c5), nn.ReLU(inplace=True),
        )
        self.block6 = nn.Sequential(
            nn.Conv2d(c5, c6, kernel_size=3, stride=1, padding=1),
            nn.BatchNorm2d(c6), nn.ReLU(inplace=True),
        )
        self.flatten = nn.Flatten()
        self.fc1 = nn.Linear(c6, fc1_dim)
        self.dropout = nn.Dropout(0.3)
        self.fc2 = nn.Linear(fc1_dim, embedding_dim)

    def forward(self, x):
        out = self.block1(x)
        out = self.block2(out)
        out = self.block3(out)
        out = out + self.res3(out)
        out = self.block4(out)
        out = out + self.res4(out)
        out = self.block5(out)
        out = self.block6(out)
        out = self.flatten(out)
        out = self.fc1(out)
        out = self.dropout(out)
        out = self.fc2(out)
        out = nn.functional.normalize(out, p=2, dim=1)
        return out


# ─── HELPERS ─────────────────────────────────────────────────────────────

def load_model(model_path, device):
    """Load fine-tuned model from checkpoint."""
    if not os.path.exists(model_path):
        print(f"ERROR: Model not found: {model_path}")
        print("Run train_vggface2.py and fine_tune.py first.")
        sys.exit(1)
    print(f"Loading model from: {model_path}")
    model = CustomCNN(embedding_dim=512)
    model.load_state_dict(
        torch.load(model_path, map_location=device, weights_only=True)
    )
    model = model.to(device)
    model.eval()
    print("Model loaded successfully.\n")
    return model


def preprocess_image(filepath, size=105):
    """
    Load and preprocess a single image for the model.

    Returns:
        Tensor (1, 3, 105, 105) ready for model input
    """
    img = Image.open(filepath).convert('RGB')
    img = TF.resize(img, (size, size))
    img = TF.to_tensor(img)
    img = TF.normalize(img, mean=[0.485, 0.456, 0.406],
                       std=[0.229, 0.224, 0.225])
    return img.unsqueeze(0)  # Add batch dimension


def get_embedding(model, filepath, device):
    """
    Get the 512-dim embedding for a face image.

    Returns:
        numpy array of shape (512,) — L2-normalized embedding vector
    """
    img_tensor = preprocess_image(filepath).to(device)
    with torch.no_grad():
        embedding = model(img_tensor)
    return embedding.cpu().numpy()[0]


def cosine_similarity(emb1, emb2):
    """
    Compute cosine similarity between two embeddings.

    Since embeddings are L2-normalized, this is just a dot product.
    Range: [-1, 1]
      - 1.0 = identical faces
      - 0.0 = unrelated
      - -1.0 = opposite (rare)

    Typical values:
      - Same person: 0.6 - 0.95
      - Different people: -0.3 - 0.3
    """
    return np.dot(emb1, emb2)


def euclidean_distance(emb1, emb2):
    """
    Compute Euclidean distance between two embeddings.
    Range: [0, 2] (since vectors are L2-normalized)
      - 0.0 = identical
      - 1.4 = typically different people
    """
    return np.linalg.norm(emb1 - emb2)


# ─── VERIFICATION LOOP ──────────────────────────────────────────────────

def verification_loop(model, device, positive_dir):
    """
    Interactive face verification using webcam.

    HOW IT WORKS:
    1. Captures a reference photo from webcam (press 'R')
    2. Then captures test photos (press 'V')
    3. Compares test photo against reference
    4. Shows similarity score and match/no-match decision

    CONTROLS:
    - R: Capture reference photo
    - V: Capture test photo and compare
    - Q: Quit

    This is the core of your application: capturing someone's face
    and verifying if they are the authorized person.
    """
    print("\n" + "="*60)
    print("  Face Verification (Webcam)")
    print("="*60)
    print("Controls: 'R' = capture reference, 'V' = verify, 'Q' = quit")
    print("="*60 + "\n")

    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        print("ERROR: Could not open webcam.")
        return

    # Load reference images from positive directory
    ref_images = [
        os.path.join(positive_dir, f)
        for f in os.listdir(positive_dir)
        if f.lower().endswith(('.jpg', '.jpeg', '.png'))
    ]

    if not ref_images:
        print("ERROR: No reference images found in:", positive_dir)
        cap.release()
        return

    # Build reference embeddings
    print(f"Loading {len(ref_images)} reference images...")
    ref_embeddings = []
    for ref_path in ref_images:
        emb = get_embedding(model, ref_path, device)
        ref_embeddings.append(emb)

    # Find the "best" reference embedding (average of all refs)
    avg_ref = np.mean(ref_embeddings, axis=0)
    print(f"Reference embedding created from {len(ref_images)} photos\n")

    ref_captured = False
    ref_img = None
    ref_name = "Reference (average of all photos)"

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        display = frame.copy()
        # Draw info text
        cv2.putText(display, "Press R to capture reference", (10, 30),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)
        cv2.putText(display, "Press V to verify", (10, 60),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)
        cv2.putText(display, "Press Q to quit", (10, 90),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)

        if ref_captured and ref_img is not None:
            cv2.imshow("Reference", ref_img)

        cv2.imshow("Verification", display)

        key = cv2.waitKey(1) & 0xFF

        if key == ord('r') or key == ord('R'):
            # Capture reference photo
            _, ref_frame = cap.read()
            ref_img = cv2.cvtColor(ref_frame, cv2.COLOR_BGR2RGB)
            ref_save_path = os.path.join(positive_dir, "webcam_ref.jpg")
            cv2.imwrite(ref_save_path, ref_frame)

            # Update reference embedding with this new photo
            new_emb = get_embedding(model, ref_save_path, device)
            # Add to reference embeddings and re-average
            ref_embeddings.append(new_emb)
            avg_ref = np.mean(ref_embeddings, axis=0)
            ref_captured = True
            print(f"[+] Reference captured and registered!")
            print(f"    Total references: {len(ref_embeddings)}")

        elif key == ord('v') or key == ord('V'):
            # Capture and verify
            _, test_frame = cap.read()
            test_img = cv2.cvtColor(test_frame, cv2.COLOR_BGR2RGB)
            test_save_path = os.path.join(positive_dir, "webcam_test.jpg")
            cv2.imwrite(test_save_path, test_frame)

            test_emb = get_embedding(model, test_save_path, device)

            # Compare against average reference embedding
            sim = cosine_similarity(avg_ref, test_emb)
            dist = euclidean_distance(avg_ref, test_emb)

            # Decision threshold
            THRESHOLD = 0.5  # Cosine similarity threshold

            if sim >= THRESHOLD:
                result = "MATCH ✓"
                color = (0, 255, 0)  # Green
            else:
                result = "NO MATCH ✗"
                color = (0, 0, 255)  # Red

            cv2.putText(display, f"{result}", (10, 130),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.8, color, 3)
            cv2.putText(display, f"Similarity: {sim:.4f}", (10, 165),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2)
            cv2.putText(display, f"Distance:   {dist:.4f}", (10, 195),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2)

            print(f"\n[VERIFICATION]")
            print(f"  Similarity: {sim:.4f} (threshold: {THRESHOLD:.4f})")
            print(f"  Distance:   {dist:.4f}")
            print(f"  Result:     {result}")
            print(f"  Same person? {sim >= THRESHOLD}")

        elif key == ord('q') or key == ord('Q'):
            break

    cap.release()
    cv2.destroyAllWindows()


# ─── PAIR COMPARISON ─────────────────────────────────────────────────────

def compare_two_images(model, path1, path2, device):
    """
    Compare two face images and show similarity.

    This is useful for debugging and testing:
    - Put two photos of the same person → expect high similarity
    - Put photos of different people → expect low similarity
    """
    print("\n" + "="*60)
    print("  Face Pair Comparison")
    print("="*60)

    emb1 = get_embedding(model, path1, device)
    emb2 = get_embedding(model, path2, device)

    sim = cosine_similarity(emb1, emb2)
    dist = euclidean_distance(emb1, emb2)

    THRESHOLD = 0.5

    print(f"\nImage 1: {os.path.basename(path1)}")
    print(f"Image 2: {os.path.basename(path2)}")
    print(f"\nCosine Similarity: {sim:.4f}")
    print(f"Euclidean Distance: {dist:.4f}")
    print(f"Threshold: {THRESHOLD:.4f}")
    print(f"\n{'MATCH ✓' if sim >= THRESHOLD else 'NO MATCH ✗'}")
    print(f"{'Same person' if sim >= THRESHOLD else 'Different people'}")

    # Visualize embeddings
    fig, axes = plt.subplots(1, 3, figsize=(15, 4))

    # Plot 1: Original images side by side
    img1 = np.array(Image.open(path1))
    img2 = np.array(Image.open(path2))
    axes[0].imshow(img1)
    axes[0].set_title("Image 1")
    axes[0].axis('off')
    axes[1].imshow(img2)
    axes[1].set_title("Image 2")
    axes[1].axis('off')

    # Plot 2: Similarity score bar
    ax2 = axes[1]  # reuse
    sim_normalized = (sim + 1) / 2  # Map [-1,1] to [0,1]
    ax2.clear()
    ax2.barh(['Similarity'], [sim_normalized])
    ax2.set_xlim(0, 1)
    ax2.set_title(f"Similarity: {sim:.4f}")
    ax2.set_xlabel("Normalized (-1 to 1)")
    for container in ax2.containers:
        ax2.bar_label(container, fmt='%.3f')

    # Plot 3: Distance bar
    ax3 = axes[2]
    dist_normalized = 1 - (dist / 2)  # Map [0,2] to [1,0]
    ax3.barh(['Distance'], [dist_normalized])
    ax3.set_xlim(0, 1)
    ax3.set_title(f"Distance: {dist:.4f}")
    ax3.set_xlabel("Normalized (0=identical, 1=opposite)")
    for container in ax3.containers:
        ax3.bar_label(container, fmt='%.3f')

    plt.tight_layout()
    plt.savefig("comparison_result.png", dpi=150, bbox_inches='tight')
    print(f"\nVisualization saved to: comparison_result.png")
    plt.show()


# ─── BATCH TEST ──────────────────────────────────────────────────────────

def batch_test(model, positive_dir, negative_dir, device):
    """
    Run a batch test on personal data.

    Tests:
    - Same-person pairs (should have high similarity)
    - Different-person pairs (should have low similarity)

    Computes:
    - Mean similarity for same-person pairs
    - Mean similarity for different-person pairs
    - ROC AUC score
    """
    print("\n" + "="*60)
    print("  Batch Test on Personal Data")
    print("="*60)

    pos_files = [f for f in os.listdir(positive_dir)
                 if f.lower().endswith(('.jpg', '.jpeg', '.png'))]
    neg_files = [f for f in os.listdir(negative_dir)
                 if f.lower().endswith(('.jpg', '.jpeg', '.png'))]

    print(f"Positive images: {len(pos_files)}")
    print(f"Negative images: {len(neg_files)}")

    # Generate same-person pairs
    same_pairs = []
    for i in range(min(50, len(pos_files))):
        for j in range(i+1, min(i+3, len(pos_files))):
            same_pairs.append((pos_files[i], pos_files[j]))

    # Generate cross-person pairs (same person, different photo)
    cross_pairs = []
    for i in range(min(50, len(pos_files))):
        for neg_file in neg_files[:20]:
            cross_pairs.append((pos_files[i], neg_file))

    if not same_pairs:
        print("Not enough positive images for batch test (need 2+)")
        return

    # Compute similarities
    same_sims = []
    cross_sims = []

    for pos_file, other_file in same_pairs:
        pos_path = os.path.join(positive_dir, pos_file)
        other_path = os.path.join(positive_dir, other_file)
        emb1 = get_embedding(model, pos_path, device)
        emb2 = get_embedding(model, other_path, device)
        same_sims.append(cosine_similarity(emb1, emb2))

    for pos_file, neg_file in cross_pairs:
        pos_path = os.path.join(positive_dir, pos_file)
        neg_path = os.path.join(negative_dir, neg_file)
        emb1 = get_embedding(model, pos_path, device)
        emb2 = get_embedding(model, neg_path, device)
        cross_sims.append(cosine_similarity(emb1, emb2))

    if not same_sims or not cross_sims:
        print("No pairs computed. Check data directories.")
        return

    # Stats
    print(f"\n{'─'*60}")
    print(f"Same-person pairs (n={len(same_sims)}):")
    print(f"  Mean similarity: {np.mean(same_sims):.4f}")
    print(f"  Std deviation:   {np.std(same_sims):.4f}")
    print(f"  Min:             {np.min(same_sims):.4f}")
    print(f"  Max:             {np.max(same_sims):.4f}")

    print(f"\nDifferent-person pairs (n={len(cross_sims)}):")
    print(f"  Mean similarity: {np.mean(cross_sims):.4f}")
    print(f"  Std deviation:   {np.std(cross_sims):.4f}")
    print(f"  Min:             {np.min(cross_sims):.4f}")
    print(f"  Max:             {np.max(cross_sims):.4f}")

    # ROC AUC
    labels = [1] * len(same_sims) + [0] * len(cross_sims)
    scores = same_sims + cross_sims
    fpr, tpr, thresholds = roc_curve(labels, scores)
    roc_auc = auc(fpr, tpr)

    print(f"\nROC AUC: {roc_auc:.4f}")
    print(f"  1.00 = perfect separation")
    print(f"  < 0.90 = model needs more training")

    # Find optimal threshold
    optimal_idx = np.argmax(tpr - fpr)
    optimal_threshold = thresholds[optimal_idx]
    print(f"\nOptimal threshold: {optimal_threshold:.4f}")

    # Plot ROC curve
    plt.figure(figsize=(8, 6))
    plt.plot(fpr, tpr, 'b-', linewidth=2, label=f'ROC (AUC = {roc_auc:.3f})')
    plt.plot([0, 1], [0, 1], 'r--', linewidth=1, label='Random')
    plt.xlabel('False Positive Rate')
    plt.ylabel('True Positive Rate')
    plt.title('ROC Curve - Face Verification')
    plt.legend(loc='lower right')
    plt.grid(True, alpha=0.3)
    plt.tight_layout()
    plt.savefig("roc_curve.png", dpi=150, bbox_inches='tight')
    print(f"ROC curve saved to: roc_curve.png")
    plt.show()


# ─── MAIN ────────────────────────────────────────────────────────────────

def main():
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Device: {device}\n")
    if torch.cuda.is_available():
        # MI50 (gfx906): bundled libMIOpen.so segfaults on this system's
        # libstdc++ (ABI mismatch). Route conv2d through native/rocBLAS instead.
        torch.backends.cudnn.enabled = False

    # Model path
    model_path = "/home/b2/projects/zavrsni/face_recognition/training_checkpoints/personal_finetuned.pt"

    # Load model
    model = load_model(model_path, device)

    # Directories
    positive_dir = "/home/b2/projects/zavrsni/face_recognition/data/positive"
    negative_dir = "/home/b2/projects/zavrsni/face_recognition/data/negative"

    while True:
        print("\n" + "="*60)
        print("  Face Recognition - Evaluation")
        print("="*60)
        print("  1. Interactive Verification (webcam)")
        print("  2. Compare Two Images")
        print("  3. Batch Test (same vs different pairs)")
        print("  4. Exit")
        print("="*60)

        choice = input("\nChoose option (1-4): ").strip()

        if choice == "1":
            verification_loop(model, device, positive_dir)
        elif choice == "2":
            path1 = input("Path to first image: ").strip()
            path2 = input("Path to second image: ").strip()
            if os.path.exists(path1) and os.path.exists(path2):
                compare_two_images(model, path1, path2, device)
            else:
                print("ERROR: One or both files not found.")
        elif choice == "3":
            batch_test(model, positive_dir, negative_dir, device)
        elif choice == "4":
            print("\nExiting evaluation.")
            break
        else:
            print("Invalid option.")


if __name__ == "__main__":
    main()
