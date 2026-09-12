import type * as OrtNS from 'onnxruntime-react-native';
import type * as FaceNS from 'react-native-vision-camera-face-detector';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import jpeg from 'jpeg-js';
import { Platform } from 'react-native';
import { storage } from './storage';

const INPUT_SIZE = 105;
const EMBEDDING_DIM = 512;
const FACE_MARGIN = 0.15;
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];
export const SIMILARITY_THRESHOLD = 0.7;

const MODEL_FILENAME = 'siamese_epoch50_int8.onnx';

let _session: OrtNS.InferenceSession | null = null;
let _ortPromise: Promise<typeof OrtNS> | null = null;
let _faceDetector: FaceNS.ImageFaceDetector | null = null;
let _facePromise: Promise<typeof FaceNS> | null = null;

function loadOrt(): Promise<typeof OrtNS> {
  if (!_ortPromise) _ortPromise = import('onnxruntime-react-native');
  return _ortPromise;
}

async function getFaceDetector(): Promise<FaceNS.ImageFaceDetector> {
  if (_faceDetector) return _faceDetector;
  if (!_facePromise) _facePromise = import('react-native-vision-camera-face-detector');
  const fd = await _facePromise;
  _faceDetector = fd.createImageFaceDetector({ performanceMode: 'accurate' });
  return _faceDetector;
}

async function resolveModelPath(): Promise<string> {
  const bundled = FileSystem.bundleDirectory + MODEL_FILENAME;
  if (Platform.OS !== 'android') return bundled;

  const unpacked = FileSystem.documentDirectory + MODEL_FILENAME;
  const existing = await FileSystem.getInfoAsync(unpacked);
  if (existing.exists && existing.size > 0) return unpacked;

  const staging = `${unpacked}.partial`;
  await FileSystem.deleteAsync(staging, { idempotent: true });
  await FileSystem.copyAsync({ from: bundled, to: staging });
  await FileSystem.moveAsync({ from: staging, to: unpacked });
  return unpacked;
}

async function getSession(): Promise<OrtNS.InferenceSession> {
  if (_session) return _session;
  const modelPath = await resolveModelPath();
  const info = await FileSystem.getInfoAsync(modelPath);
  if (!info.exists) {
    throw new Error(`Model not found at: ${modelPath}`);
  }
  const plainPath = modelPath.replace('file://', '');
  const ort = await loadOrt();
  _session = await ort.InferenceSession.create(plainPath);
  return _session;
}

async function faceCropRect(uri: string) {
  const detector = await getFaceDetector();
  const faces = detector.detectFaces(uri);
  if (!faces || faces.length === 0) {
    throw new Error('No face detected — center your face in the frame and try again');
  }

  let best = faces[0];
  for (const f of faces) {
    if (f.bounds.width * f.bounds.height > best.bounds.width * best.bounds.height) best = f;
  }

  const { x, y, width, height } = best.bounds;
  const margin = Math.max(width, height) * FACE_MARGIN;
  const originX = Math.max(0, Math.round(x - margin));
  const originY = Math.max(0, Math.round(y - margin));
  const endX = Math.min(best.frameWidth, Math.round(x + width + margin));
  const endY = Math.min(best.frameHeight, Math.round(y + height + margin));

  return { originX, originY, width: endX - originX, height: endY - originY };
}

async function preprocessImage(uri: string): Promise<Float32Array> {
  const crop = await faceCropRect(uri);
  const resized = await ImageManipulator.manipulateAsync(
    uri,
    [{ crop }, { resize: { width: INPUT_SIZE, height: INPUT_SIZE } }],
    { format: ImageManipulator.SaveFormat.JPEG, base64: true }
  );

  const binaryStr = atob(resized.base64!);
  const jpegBytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    jpegBytes[i] = binaryStr.charCodeAt(i);
  }

  const decoded = jpeg.decode(jpegBytes, { useTArray: true });
  const { data } = decoded;

  const tensor = new Float32Array(3 * INPUT_SIZE * INPUT_SIZE);
  for (let y = 0; y < INPUT_SIZE; y++) {
    for (let x = 0; x < INPUT_SIZE; x++) {
      const src = (y * INPUT_SIZE + x) * 4;
      for (let c = 0; c < 3; c++) {
        tensor[c * INPUT_SIZE * INPUT_SIZE + y * INPUT_SIZE + x] =
          (data[src + c] / 255.0 - MEAN[c]) / STD[c];
      }
    }
  }
  return tensor;
}

async function embed(uri: string): Promise<Float32Array> {
  const pixels = await preprocessImage(uri);
  const sess = await getSession();
  const ort = await loadOrt();
  const inputTensor = new ort.Tensor('float32', pixels, [1, 3, INPUT_SIZE, INPUT_SIZE]);
  const output = await sess.run({ image: inputTensor });
  return output['embedding'].data as Float32Array;
}

function dotProduct(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < EMBEDDING_DIM; i++) sum += a[i] * b[i];
  return sum;
}

function embeddingToBase64(embedding: Float32Array): string {
  const bytes = new Uint8Array(embedding.buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToEmbedding(b64: string): Float32Array {
  const binaryStr = atob(b64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

export type FaceScanResult = {
  ok: boolean;
  score: number;
  reason?: string;
};

export async function isFaceRegistered(): Promise<boolean> {
  return (await storage.getFaceRegistered()) === 'true';
}

export async function registerFaceFromUri(uri: string): Promise<{ ok: boolean }> {
  const embedding = await embed(uri);
  await storage.setFaceEmbedding(embeddingToBase64(embedding));
  await storage.setFaceRegistered('true');
  return { ok: true };
}

export async function verifyFaceFromUri(uri: string): Promise<FaceScanResult> {
  const refB64 = await storage.getFaceEmbedding();
  if (!refB64) {
    return { ok: false, score: 0, reason: 'No face registered — register your face first' };
  }
  const refEmbedding = base64ToEmbedding(refB64);

  let liveEmbedding: Float32Array;
  try {
    liveEmbedding = await embed(uri);
  } catch (e: any) {
    return { ok: false, score: 0, reason: String(e?.message ?? 'Face processing failed') };
  }

  const score = dotProduct(liveEmbedding, refEmbedding);
  if (score >= SIMILARITY_THRESHOLD) {
    return { ok: true, score };
  }
  return { ok: false, score, reason: `Face not recognized (score ${score.toFixed(2)})` };
}

export async function resetFace(): Promise<void> {
  await storage.setFaceRegistered('false');
  await storage.deleteFaceEmbedding();
}
