/**
 * The backend's only door to Ethereum.
 *
 * Until this existed the three deployed contracts were unreachable from Node:
 * DIDs lived only in SQLite, `AccessPolicy.hasAccess()` was never asked, and the
 * on-chain AuditLog stayed empty. Everything here wraps the ABI surface the
 * access path and enrolment actually use — nothing more.
 *
 * DEGRADED MODE: when no RPC is configured `isEnabled()` is false and every
 * read resolves to a "chain says nothing" value. That keeps tests and a
 * chain-less dev machine working, but it is not a security decision — the
 * caller decides whether a missing chain means allow or deny (see
 * `config.chain.requireChain`).
 */
import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import logger from '../lib/logger';
import { config } from '../config/conifg';

// Minimal ABIs. Deliberately hand-written rather than imported from the hardhat
// artifacts directory so the backend does not depend on the blockchain package
// having been compiled.
const DID_REGISTRY_ABI = [
  'function registerDID(string _did, bytes _publicKey) external',
  'function getPublicKey(string _did) external view returns (bytes)',
  'function isRegistered(string _did) external view returns (bool)',
  'function getRegisteredDIDCount() external view returns (uint256)',
];

const ACCESS_POLICY_ABI = [
  'function grantAccess(string _did, string _doorCode, uint256 _startTime, uint256 _endTime) external returns (string)',
  'function revokeAccess(string _policyId) external',
  'function hasAccess(string _did, string _doorCode) external view returns (bool)',
  'function getPolicyCount() external view returns (uint256)',
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
  /** The wallet wrapped in nonce tracking; what the contracts actually use. */
  signer?: ethers.NonceManager;
  registry?: ethers.Contract;
  policy?: ethers.Contract;
  audit?: ethers.Contract;
  addresses?: ChainAddresses;
  reason?: string;
}

let state: ChainState = { enabled: false, reason: 'not initialised' };

/**
 * Read `blockchain/deployments/<network>.json` — the manifest `deploy.js`
 * writes. Explicit CONTRACT_* env vars win, so a deployment made elsewhere can
 * be pointed at without copying files around.
 */
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

/** Wire up provider, wallet and contracts. Safe to call more than once. */
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
    // A read-only setup is legitimate: a backend that only checks policy needs
    // no key. Writes then fail loudly rather than silently doing nothing.
    const wallet = config.chain.backendPrivateKey
      ? new ethers.Wallet(config.chain.backendPrivateKey, provider)
      : undefined;
    // A bare Wallet asks the node for its pending nonce on every send, so two
    // sends that overlap read the same value and the loser is rejected as
    // NONCE_EXPIRED. NonceManager keeps the counter locally and hands out a
    // fresh one per send; the write queue below keeps those sends in order.
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

/** Test seam — lets a suite drive a hardhat node without touching env vars. */
export function __setStateForTests(next: Partial<ChainState>) {
  state = { ...state, ...next } as ChainState;
}

// ── Reads ────────────────────────────────────────────────────────────────────

/**
 * The on-chain public key for a DID, or null when the chain is off or the DID
 * was never registered. Callers must distinguish "no key" from "wrong key" —
 * returning null here is not an authorisation decision.
 */
export async function getPublicKey(did: string): Promise<string | null> {
  if (!state.enabled) return null;
  try {
    const key: string = await state.registry!.getPublicKey(did);
    return key && key !== '0x' ? key : null;
  } catch {
    // DIDNotRegistered reverts; that is a normal answer, not a failure.
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

/** Does AccessPolicy allow this DID through this door right now? */
export async function hasAccess(did: string, doorCode: string): Promise<boolean> {
  if (!state.enabled) return false;
  try {
    return await state.policy!.hasAccess(did, doorCode);
  } catch (err) {
    logger.error(`[chain] hasAccess failed for ${did}/${doorCode}: ${(err as Error).message}`);
    return false;
  }
}

/**
 * Is this DID on the revocation list?
 *
 * Two different "false"s here: a disabled chain has no revocation list to
 * consult, so it reports not-revoked and the caller's `requireChain` setting
 * decides what that is worth. A chain that is configured but unreachable fails
 * CLOSED and reports revoked — a network outage must not be a way to slip a
 * revoked phone through.
 */
export async function isRevoked(did: string): Promise<boolean> {
  if (!state.enabled) return false;
  try {
    return await state.audit!.isRevoked(did);
  } catch (err) {
    logger.error(`[chain] isRevoked failed for ${did}: ${(err as Error).message} — failing closed`);
    return true;
  }
}

// ── Writes ───────────────────────────────────────────────────────────────────

function requireSigner(op: string): ethers.Wallet {
  if (!state.enabled) throw new Error(`[chain] ${op}: chain disabled (${state.reason})`);
  if (!state.wallet) throw new Error(`[chain] ${op}: no CHAIN_BACKEND_PRIVATE_KEY configured`);
  return state.wallet;
}

/**
 * Every write goes through one wallet, and a wallet has one nonce sequence.
 * Two sends in flight at once both read the same pending nonce and the second
 * is rejected as NONCE_EXPIRED — which is not hypothetical here, because
 * `logEventAsync` deliberately does not await, so an unlock's audit write
 * overlaps whatever enrolment or revocation happens next.
 *
 * Serialising through a promise chain makes each send read the nonce only after
 * the previous one has been accepted. Writes are rare and off the critical path
 * (the unlock decision comes from free view calls), so the queue costs nothing
 * that matters.
 */
let writeQueue: Promise<unknown> = Promise.resolve();

function enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
  const run = async (): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      // A send that never landed leaves NonceManager's local counter one ahead
      // of the chain, which would fail every subsequent write too. Drop the
      // local count so the next send re-reads it from the node.
      state.signer?.reset();
      throw err;
    }
  };
  // Swallow the predecessor's rejection so one failed write cannot poison the
  // queue for every write after it.
  const next = writeQueue.then(run, run);
  writeQueue = next.catch(() => {});
  return next;
}

/** Bind a DID to its device public key. Called once, at enrolment. */
export async function registerDID(did: string, publicKey: string): Promise<string> {
  requireSigner('registerDID');
  return enqueueWrite(async () => {
    const tx = await state.registry!.registerDID(did, publicKey);
    await tx.wait();
    return tx.hash;
  });
}

/**
 * Append an access-event hash.
 *
 * Fire-and-forget on purpose: a block takes ~12s on a public network and nobody
 * waits at a door that long. The unlock decision comes from the free view calls
 * above; this is the durable record catching up afterwards.
 */
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

export async function grantAccess(
  did: string,
  doorCode: string,
  startTime = 0,
  endTime = 0,
): Promise<string> {
  requireSigner('grantAccess');
  return enqueueWrite(async () => {
    const tx = await state.policy!.grantAccess(did, doorCode, startTime, endTime);
    await tx.wait();
    return tx.hash;
  });
}
