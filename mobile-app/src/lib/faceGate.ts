/**
 * Face-recognition gate.
 *
 * This is the single seam where the on-device Siamese model plugs in later.
 * For now (Expo Go, no native ML runtime) it is STUBBED: registration just
 * records that a face was "enrolled", and a scan simulates work and succeeds.
 *
 * When you do a custom dev build on the Mac, replace the bodies of
 * `registerFace` and `scanFace` with:
 *   1. camera capture (expo-camera),
 *   2. preprocess to 105x105 / 255.0,
 *   3. run the converted Siamese model (onnxruntime-react-native / tflite),
 *   4. compare against the stored reference embedding/image.
 * The rest of the app (TOTP generate -> send -> verify) does not change.
 */

import { storage } from './storage';

export type FaceScanResult = {
  ok: boolean;
  /** 0..1 similarity score (stub returns a fixed high score). */
  score: number;
  reason?: string;
};

const SIMULATED_SCAN_MS = 1500;

/** Whether a reference face has been registered on this device. */
export async function isFaceRegistered(): Promise<boolean> {
  return (await storage.getFaceRegistered()) === 'true';
}

/**
 * Register the user's reference face.
 * STUB: marks the device as enrolled. Real impl captures + stores an embedding.
 */
export async function registerFace(): Promise<{ ok: boolean }> {
  await new Promise((r) => setTimeout(r, SIMULATED_SCAN_MS));
  await storage.setFaceRegistered('true');
  return { ok: true };
}

/** Forget the registered reference face. */
export async function resetFace(): Promise<void> {
  await storage.setFaceRegistered('false');
}

/**
 * Scan the live face and compare against the registered reference.
 * STUB: simulates a scan and passes. Real impl runs the Siamese model.
 */
export async function scanFace(): Promise<FaceScanResult> {
  const registered = await isFaceRegistered();
  if (!registered) {
    return { ok: false, score: 0, reason: 'No face registered on this device' };
  }
  await new Promise((r) => setTimeout(r, SIMULATED_SCAN_MS));
  // Stub always matches. Swap for real inference + threshold check.
  return { ok: true, score: 0.97 };
}
