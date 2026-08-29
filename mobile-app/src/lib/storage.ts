import * as SecureStore from 'expo-secure-store';
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';

// Face embedding is 2048 bytes as binary → ~2730 chars base64, over SecureStore's 2KB limit.
// Store it as a plain file in the app's document directory instead.
const EMBEDDING_FILE = FileSystem.documentDirectory + 'face_embedding.b64';

const KEYS = {
  accessToken: 'accessToken',
  refreshToken: 'refreshToken',
  projectId: 'projectId',
  did: 'did',
  privateKey: 'privateKey',
  doors: 'doors',
  buildingName: 'buildingName',
  totpSecret: 'totpSecret',
  totpPeriod: 'totpPeriod',
  totpDigits: 'totpDigits',
  faceRegistered: 'faceRegistered',
  livenessEnabled: 'livenessEnabled',
} as const;

const get = (key: string): Promise<string | null> => {
  if (Platform.OS === 'web') return Promise.resolve(localStorage.getItem(key));
  return SecureStore.getItemAsync(key);
};

const set = (key: string, value: string): Promise<void> => {
  if (Platform.OS === 'web') { localStorage.setItem(key, value); return Promise.resolve(); }
  return SecureStore.setItemAsync(key, value);
};

const del = (key: string): Promise<void> => {
  if (Platform.OS === 'web') { localStorage.removeItem(key); return Promise.resolve(); }
  return SecureStore.deleteItemAsync(key);
};

export const storage = {
  getAccessToken: () => get(KEYS.accessToken),
  setAccessToken: (v: string) => set(KEYS.accessToken, v),
  deleteAccessToken: () => del(KEYS.accessToken),

  getRefreshToken: () => get(KEYS.refreshToken),
  setRefreshToken: (v: string) => set(KEYS.refreshToken, v),
  deleteRefreshToken: () => del(KEYS.refreshToken),

  getProjectId: () => get(KEYS.projectId),
  setProjectId: (v: string) => set(KEYS.projectId, v),
  deleteProjectId: () => del(KEYS.projectId),

  // Device identity (DID) + on-device TOTP secret
  getDid: () => get(KEYS.did),
  setDid: (v: string) => set(KEYS.did, v),

  // secp256k1 private key, hex. The one value in the app that must never be
  // transmitted anywhere — SecureStore keeps it in the Keychain/Keystore.
  getPrivateKey: () => get(KEYS.privateKey),
  setPrivateKey: (v: string) => set(KEYS.privateKey, v),
  deletePrivateKey: () => del(KEYS.privateKey),

  // Doors this building offers, as returned by the enrolment claim. Cached so
  // the door picker renders before any network call.
  getDoors: () => get(KEYS.doors),
  setDoors: (v: string) => set(KEYS.doors, v),

  getBuildingName: () => get(KEYS.buildingName),
  setBuildingName: (v: string) => set(KEYS.buildingName, v),

  getTotpSecret: () => get(KEYS.totpSecret),
  setTotpSecret: (v: string) => set(KEYS.totpSecret, v),

  getTotpPeriod: () => get(KEYS.totpPeriod),
  setTotpPeriod: (v: string) => set(KEYS.totpPeriod, v),

  getTotpDigits: () => get(KEYS.totpDigits),
  setTotpDigits: (v: string) => set(KEYS.totpDigits, v),

  // Face gate
  getFaceRegistered: () => get(KEYS.faceRegistered),
  setFaceRegistered: (v: string) => set(KEYS.faceRegistered, v),

  // Liveness check toggle (blink detection before face verification)
  getLivenessEnabled: () => get(KEYS.livenessEnabled),
  setLivenessEnabled: (v: string) => set(KEYS.livenessEnabled, v),

  // 512-dim float32 embedding (~2.7 KB) — stored as a file, not in SecureStore
  getFaceEmbedding: (): Promise<string | null> =>
    FileSystem.readAsStringAsync(EMBEDDING_FILE).catch(() => null),
  setFaceEmbedding: (v: string): Promise<void> =>
    FileSystem.writeAsStringAsync(EMBEDDING_FILE, v),
  deleteFaceEmbedding: (): Promise<void> =>
    FileSystem.deleteAsync(EMBEDDING_FILE, { idempotent: true }),

  clearEnrollment: () =>
    Promise.all([
      del(KEYS.did),
      del(KEYS.privateKey),
      del(KEYS.doors),
      del(KEYS.buildingName),
      del(KEYS.totpSecret),
      del(KEYS.totpPeriod),
      del(KEYS.totpDigits),
      del(KEYS.faceRegistered),
    ]).then(() => {}),

  clearAuth: () => Promise.all([del(KEYS.accessToken), del(KEYS.refreshToken), del(KEYS.projectId)]).then(() => {}),
};
