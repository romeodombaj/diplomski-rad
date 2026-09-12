import * as SecureStore from 'expo-secure-store';
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';

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

  getDid: () => get(KEYS.did),
  setDid: (v: string) => set(KEYS.did, v),

  getPrivateKey: () => get(KEYS.privateKey),
  setPrivateKey: (v: string) => set(KEYS.privateKey, v),
  deletePrivateKey: () => del(KEYS.privateKey),

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

  getFaceRegistered: () => get(KEYS.faceRegistered),
  setFaceRegistered: (v: string) => set(KEYS.faceRegistered, v),

  getLivenessEnabled: () => get(KEYS.livenessEnabled),
  setLivenessEnabled: (v: string) => set(KEYS.livenessEnabled, v),

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
