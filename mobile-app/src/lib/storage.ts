import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const KEYS = {
  accessToken: 'accessToken',
  refreshToken: 'refreshToken',
  projectId: 'projectId',
  did: 'did',
  totpSecret: 'totpSecret',
  totpPeriod: 'totpPeriod',
  totpDigits: 'totpDigits',
  faceRegistered: 'faceRegistered',
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

  getTotpSecret: () => get(KEYS.totpSecret),
  setTotpSecret: (v: string) => set(KEYS.totpSecret, v),

  getTotpPeriod: () => get(KEYS.totpPeriod),
  setTotpPeriod: (v: string) => set(KEYS.totpPeriod, v),

  getTotpDigits: () => get(KEYS.totpDigits),
  setTotpDigits: (v: string) => set(KEYS.totpDigits, v),

  // Face gate
  getFaceRegistered: () => get(KEYS.faceRegistered),
  setFaceRegistered: (v: string) => set(KEYS.faceRegistered, v),

  clearEnrollment: () =>
    Promise.all([
      del(KEYS.did),
      del(KEYS.totpSecret),
      del(KEYS.totpPeriod),
      del(KEYS.totpDigits),
      del(KEYS.faceRegistered),
    ]).then(() => {}),

  clearAuth: () => Promise.all([del(KEYS.accessToken), del(KEYS.refreshToken), del(KEYS.projectId)]).then(() => {}),
};
