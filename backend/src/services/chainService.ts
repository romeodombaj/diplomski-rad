import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import logger from '../lib/logger';
import { config } from '../config/conifg';

const DID_REGISTRY_ABI = [
  'function registerDID(string _did, bytes _publicKey) external',
  'function getPublicKey(string _did) external view returns (bytes)',
  'function isRegistered(string _did) external view returns (bool)',
  'function getRegisteredDIDCount() external view returns (uint256)',
];

const ACCESS_POLICY_ABI = [
  'function grantAccess(string _did, string _doorCode, uint256 _startTime, uint256 _endTime, bytes32 _scheduleHash) external returns (string)',
  'function revokeAccess(string _policyId) external',
  'function hasAccess(string _did, string _doorCode) external view returns (bool)',
  'function hasAccessWithSchedule(string _did, string _doorCode) external view returns (bool allowed, bytes32 scheduleHash)',
  'function getPolicy(string _policyId) external view returns (tuple(string did, string doorCode, uint256 startTime, uint256 endTime, bool active, string policyId, bytes32 scheduleHash))',
  'function getPoliciesForDID(string _did) external view returns (tuple(string did, string doorCode, uint256 startTime, uint256 endTime, bool active, string policyId, bytes32 scheduleHash)[])',
  'function getPolicyCount() external view returns (uint256)',
  'event AccessGranted(string policyId, string did, string doorCode, uint256 startTime, uint256 endTime, bytes32 scheduleHash)',
];

const AUDIT_LOG_ABI = [
  'function logEvent(string _eventHash, string _doorCode) external',
  'function revokeDID(string _did) external',
  'function restoreDID(string _did) external',
  'function isRevoked(string _did) external view returns (bool)',
  'function getEventCount() external view returns (uint256)',
];

export interface ChainAddresses {
  DIDRegistry: string;
  AccessPolicy: string;
  AuditLog: string;
}

interface ChainState {
  enabled: boolean;
  provider?: ethers.JsonRpcProvider;
  wallet?: ethers.Wallet;
  signer?: ethers.NonceManager;
  registry?: ethers.Contract;
  policy?: ethers.Contract;
  audit?: ethers.Contract;
  addresses?: ChainAddresses;
  reason?: string;
}

let state: ChainState = { enabled: false, reason: 'not initialised' };

function loadAddresses(): ChainAddresses | null {
  const { didRegistry, accessPolicy, auditLog } = config.chain.contracts;
  if (didRegistry && accessPolicy && auditLog) {
    return { DIDRegistry: didRegistry, AccessPolicy: accessPolicy, AuditLog: auditLog };
  }

  const file = config.chain.deploymentFile
    ? path.resolve(config.chain.deploymentFile)
    : path.resolve(process.cwd(), '..', 'blockchain', 'deployments', `${config.chain.network}.json`);

  try {
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    const c = manifest?.contracts;
    if (c?.DIDRegistry && c?.AccessPolicy && c?.AuditLog) return c as ChainAddresses;
    return null;
  } catch {
    return null;
  }
}

export function init(): ChainState {
  if (!config.chain.rpcUrl) {
    state = { enabled: false, reason: 'CHAIN_RPC_URL not set' };
    return state;
  }

  const addresses = loadAddresses();
  if (!addresses) {
    state = { enabled: false, reason: 'no deployment manifest or CONTRACT_* addresses found' };
    logger.warn(`[chain] disabled — ${state.reason}`);
    return state;
  }

  try {
    const provider = new ethers.JsonRpcProvider(config.chain.rpcUrl);
    const wallet = config.chain.backendPrivateKey
      ? new ethers.Wallet(config.chain.backendPrivateKey, provider)
      : undefined;
    const signer = wallet ? new ethers.NonceManager(wallet) : undefined;
    const runner = signer ?? provider;

    state = {
      enabled: true,
      provider,
      wallet,
      signer,
      addresses,
      registry: new ethers.Contract(addresses.DIDRegistry, DID_REGISTRY_ABI, runner),
      policy: new ethers.Contract(addresses.AccessPolicy, ACCESS_POLICY_ABI, runner),
      audit: new ethers.Contract(addresses.AuditLog, AUDIT_LOG_ABI, runner),
    };
    logger.info(
      `[chain] enabled — network=${config.chain.network} registry=${addresses.DIDRegistry}` +
        (wallet ? ` signer=${wallet.address}` : ' (read-only, no CHAIN_BACKEND_PRIVATE_KEY)'),
    );
  } catch (err) {
    state = { enabled: false, reason: (err as Error).message };
    logger.error(`[chain] init failed — ${state.reason}`);
  }
  return state;
}

export const isEnabled = () => state.enabled;
export const status = () => ({
  enabled: state.enabled,
  reason: state.reason,
  network: config.chain.network,
  addresses: state.addresses ?? null,
  signer: state.wallet?.address ?? null,
});

export function __setStateForTests(next: Partial<ChainState>) {
  state = { ...state, ...next } as ChainState;
}


export async function getPublicKey(did: string): Promise<string | null> {
  if (!state.enabled) return null;
  try {
    const key: string = await state.registry!.getPublicKey(did);
    return key && key !== '0x' ? key : null;
  } catch {
    return null;
  }
}

export async function isRegistered(did: string): Promise<boolean> {
  if (!state.enabled) return false;
  try {
    return await state.registry!.isRegistered(did);
  } catch {
    return false;
  }
}

export async function hasAccess(did: string, doorCode: string): Promise<boolean> {
  if (!state.enabled) return false;
  try {
    return await state.policy!.hasAccess(did, doorCode);
  } catch (err) {
    logger.error(`[chain] hasAccess failed for ${did}/${doorCode}: ${(err as Error).message}`);
    return false;
  }
}

export async function isRevoked(did: string): Promise<boolean> {
  if (!state.enabled) return false;
  try {
    return await state.audit!.isRevoked(did);
  } catch (err) {
    logger.error(`[chain] isRevoked failed for ${did}: ${(err as Error).message} — failing closed`);
    return true;
  }
}


function requireSigner(op: string): ethers.Wallet {
  if (!state.enabled) throw new Error(`[chain] ${op}: chain disabled (${state.reason})`);
  if (!state.wallet) throw new Error(`[chain] ${op}: no CHAIN_BACKEND_PRIVATE_KEY configured`);
  return state.wallet;
}

let writeQueue: Promise<unknown> = Promise.resolve();

function enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
  const run = async (): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      state.signer?.reset();
      throw err;
    }
  };
  const next = writeQueue.then(run, run);
  writeQueue = next.catch(() => {});
  return next;
}

export async function registerDID(did: string, publicKey: string): Promise<string> {
  requireSigner('registerDID');
  return enqueueWrite(async () => {
    const tx = await state.registry!.registerDID(did, publicKey);
    await tx.wait();
    return tx.hash;
  });
}

export function logEventAsync(eventHash: string, doorCode: string): void {
  if (!state.enabled || !state.signer) return;
  enqueueWrite(async () => {
    const tx: ethers.TransactionResponse = await state.audit!.logEvent(eventHash, doorCode);
    logger.info(`[chain] logEvent ${eventHash.slice(0, 12)}… door=${doorCode} tx=${tx.hash}`);
    return tx.hash;
  }).catch((err: Error) => logger.error(`[chain] logEvent failed: ${err.message}`));
}

export async function revokeDID(did: string): Promise<string> {
  requireSigner('revokeDID');
  return enqueueWrite(async () => {
    const tx = await state.audit!.revokeDID(did);
    await tx.wait();
    return tx.hash;
  });
}

export const NO_SCHEDULE = ethers.ZeroHash;

export interface GrantResult {
  policyId: string;
  txHash: string;
}

export async function grantAccess(
  did: string,
  doorCode: string,
  startTime = 0,
  endTime = 0,
  scheduleHash: string = NO_SCHEDULE,
): Promise<GrantResult> {
  requireSigner('grantAccess');
  return enqueueWrite(async () => {
    const tx = await state.policy!.grantAccess(did, doorCode, startTime, endTime, scheduleHash);
    const receipt = await tx.wait();
    let policyId = '';
    for (const log of receipt.logs) {
      try {
        const parsed = state.policy!.interface.parseLog(log);
        if (parsed?.name === 'AccessGranted') {
          policyId = parsed.args.policyId;
          break;
        }
      } catch {
      }
    }
    if (!policyId) throw new Error('grantAccess: AccessGranted not emitted');
    return { policyId, txHash: tx.hash };
  });
}

export async function revokeAccess(policyId: string): Promise<string> {
  requireSigner('revokeAccess');
  return enqueueWrite(async () => {
    const tx = await state.policy!.revokeAccess(policyId);
    await tx.wait();
    return tx.hash;
  });
}

export interface ChainPolicy {
  did: string;
  doorCode: string;
  startTime: number;
  endTime: number;
  active: boolean;
  policyId: string;
  scheduleHash: string;
}

const toChainPolicy = (p: any): ChainPolicy => ({
  did: p.did,
  doorCode: p.doorCode,
  startTime: Number(p.startTime),
  endTime: Number(p.endTime),
  active: p.active,
  policyId: p.policyId,
  scheduleHash: p.scheduleHash,
});

export async function getPoliciesForDID(did: string): Promise<ChainPolicy[]> {
  if (!state.enabled) return [];
  try {
    const rows = await state.policy!.getPoliciesForDID(did);
    return rows.map(toChainPolicy);
  } catch (err) {
    logger.error(`[chain] getPoliciesForDID ${did} failed: ${(err as Error).message}`);
    throw err;
  }
}

export async function hasAccessWithSchedule(
  did: string,
  doorCode: string,
): Promise<{ allowed: boolean; scheduleHash: string } | null> {
  if (!state.enabled) return null;
  try {
    const [allowed, scheduleHash] = await state.policy!.hasAccessWithSchedule(did, doorCode);
    return { allowed, scheduleHash };
  } catch (err) {
    logger.error(`[chain] hasAccessWithSchedule ${did}/${doorCode}: ${(err as Error).message}`);
    return { allowed: false, scheduleHash: NO_SCHEDULE };
  }
}
