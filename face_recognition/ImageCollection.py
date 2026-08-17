import cv2
import os
import time

# --- CONFIGURATION ---
# This path points from Windows into your Ubuntu/WSL filesystem
BASE_PATH = r"\\wsl.localhost\Ubuntu\home\romeodombaj\fax\zavrsni"
FOLDER_NAME = "application_data/verification_images"
SAVE_PATH = os.path.join(BASE_PATH, FOLDER_NAME)

# Create folder if it doesn't exist
if not os.path.exists(SAVE_PATH):
    try:
        os.makedirs(SAVE_PATH)
        print(f"Created folder: {SAVE_PATH}")
    except Exception as e:
        print(f"Error creating WSL folder: {e}")
        print("Falling back to saving on Desktop...")
        SAVE_PATH = "my_captured_faces"
        if not os.path.exists(SAVE_PATH): os.makedirs(SAVE_PATH)

def run_collector():
    cap = cv2.VideoCapture(0) # 0 is usually your integrated camera
    
    if not cap.isOpened():
        print("Could not open camera. Try closing other apps (Zoom, Teams, etc.)")
        return

    print("--- INSTRUCTIONS ---")
    print("1. Press 'S' to save a photo")
    print("2. Press 'Q' to quit")
    print(f"Saving to: {SAVE_PATH}")

    count = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break

        frame = frame[120:120+250, 200:200+250,:]

        frame = cv2.rotate(frame, cv2.ROTATE_90_CLOCKWISE)

        
        # Display the camera feed
        cv2.imshow("Zavrsni Rad - Image Collection", frame)

        key = cv2.waitKey(1) & 0xFF
        
        # Save image when 's' is pressed
        if key == ord('s'):
            timestamp = int(time.time())
            filename = f"face_{timestamp}_{count}.jpg"
            full_path = os.path.join(SAVE_PATH, filename)
            
            cv2.imwrite(full_path, frame)
            print(f"[{count+1}] Saved: {filename}")
            count += 1

        # Quit when 'q' is pressed
        elif key == ord('q'):
            break

    cap.release()
    cv2.destroyAllWindows()
    print(f"\nFinished! Collected {count} images.")

if __name__ == "__main__":
    run_collector()