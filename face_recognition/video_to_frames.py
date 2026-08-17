import cv2
import os
import sys

# Usage: python video_to_frames.py <video_file> <output_folder> [frame_interval]
#   frame_interval = save every Nth frame (default 10, so ~3fps from a 30fps video)
# Example: python video_to_frames.py myvideo.mp4 data/anchor 10

def center_crop_square(frame):
    h, w = frame.shape[:2]
    size = min(h, w)
    y = (h - size) // 2
    x = (w - size) // 2
    return frame[y:y+size, x:x+size]

def extract_frames(video_path, output_dir, frame_interval=10):
    os.makedirs(output_dir, exist_ok=True)

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print(f"Error: cannot open {video_path}")
        return

    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fps = cap.get(cv2.CAP_PROP_FPS)
    print(f"Video: {total} frames at {fps:.1f} fps — saving every {frame_interval}th frame")

    saved = 0
    frame_idx = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        if frame_idx % frame_interval == 0:
            cropped = center_crop_square(frame)
            filename = os.path.join(output_dir, f"frame_{frame_idx:06d}.jpg")
            cv2.imwrite(filename, cropped)
            saved += 1

        frame_idx += 1

    cap.release()
    print(f"Done — saved {saved} frames to '{output_dir}'")

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python video_to_frames.py <video_file> <output_folder> [frame_interval]")
        print("Example: python video_to_frames.py myvideo.mp4 data/anchor 10")
        sys.exit(1)

    video_path = sys.argv[1]
    output_dir = sys.argv[2]
    interval = int(sys.argv[3]) if len(sys.argv) > 3 else 10

    extract_frames(video_path, output_dir, interval)
