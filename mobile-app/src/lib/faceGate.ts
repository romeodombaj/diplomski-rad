import * as ort from 'onnxruntime-react-native';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import jpeg from 'jpeg-js';
import { storage } from './storage';

const INPUT_SIZE = 105;
const EMBEDDING_DIM = 512;
// ImageNet normalization — must match the preprocessing used during training
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];
// Cosine similarity threshold (embeddings are L2-normalized, so dot product = cosine sim).
// 0.5 matches the threshold used in evaluate.py.
const SIMILARITY_THRESHOLD = 0.7;

const MODEL_FILENAME = 'siamese_epoch50_int8.onnx';

let _session: ort.InferenceSession | null = null;

async function getSession(): Promise<ort.InferenceSession> {
  if (_session) return _session;
  // Model is bundled as a native iOS resource via the withOnnxModel config plugin.
  // FileSystem.bundleDirectory points to the .app bundle root on iOS.
  const modelPath = FileSystem.bundleDirectory + MODEL_FILENAME;
  const info = await FileSystem.getInfoAsync(modelPath);
  if (!info.exists) {
    throw new Error(`Model not found at: ${modelPath}`);
  }
  // onnxruntime-react-native expects a plain file path, not a file:// URI
  const plainPath = modelPath.replace('file://', '');
  _session = await ort.InferenceSession.create(plainPath);
  return _session;
}

async function preprocessImage(uri: string): Promise<Float32Array> {
  // Resize to 105×105 and get base64 JPEG
  const resized = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: INPUT_SIZE, height: INPUT_SIZE } }],
    { format: ImageManipulator.SaveFormat.JPEG, base64: true }
  );

  // Decode base64 → Uint8Array
  const binaryStr = atob(resized.base64!);
  const jpegBytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    jpegBytes[i] = binaryStr.charCodeAt(i);
  }

  // Decode JPEG → RGBA pixel data
  const decoded = jpeg.decode(jpegBytes, { useTArray: true });
  const { data } = decoded; // Uint8Array, RGBA, INPUT_SIZE * INPUT_SIZE * 4 bytes

  // Convert RGBA to CHW Float32 with ImageNet normalization
  const tensor = new Float32Array(3 * INPUT_SIZE * INPUT_SIZE);
  for (let y = 0; y < INPUT_SIZE; y++) {
    for (let x = 0; x < INPUT_SIZE; x++) {
      const src = (y * INPUT_SIZE + x) * 4; // RGBA offset
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
  const inputTensor = new ort.Tensor('float32', pixels, [1, 3, INPUT_SIZE, INPUT_SIZE]);
  const output = await sess.run({ image: inputTensor });
  return output['embedding'].data as Float32Array; // 512-dim L2-normalized
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
  const liveEmbedding = await embed(uri);
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
