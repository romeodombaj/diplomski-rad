import dotenv from "dotenv";

// Load .env.development when not in production — production has no .env file, values fall back to the hardcoded defaults below
if (process.env.NODE_ENV !== "production") {
    dotenv.config({ path: "./.env.development" });
}

/**
 * `Number(x) || fallback` treats a deliberate 0 as unset and turns a typo into
 * a silent default — for a face threshold or a request-age bound that is a
 * security setting changing itself behind your back. This keeps 0, and refuses
 * to boot on a value that is not a number at all.
 */
function num(raw: string | undefined, fallback: number): number {
    if (raw === undefined || raw.trim() === '') return fallback;
    const parsed = Number(raw);
    if (Number.isNaN(parsed)) {
        throw new Error(`Invalid numeric config value: "${raw}" (expected a number)`);
    }
    return parsed;
}

export const config = {
    port: num(process.env.PORT, 5000),
    env: process.env.NODE_ENV || "production",
    rateLimit: {
        windowMs:     num(process.env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
        max:          num(process.env.RATE_LIMIT_MAX, 300),
        v1Max:        num(process.env.RATE_LIMIT_V1_MAX, 1000),
        authWindowMs: num(process.env.RATE_LIMIT_AUTH_WINDOW_MS, 15 * 60 * 1000),
        authMax:      num(process.env.RATE_LIMIT_AUTH_MAX,        10),
        // Unauthenticated mobile surface; keyed by IP. See mobileRateLimiter.
        mobileWindowMs: num(process.env.RATE_LIMIT_MOBILE_WINDOW_MS, 60 * 1000),
        mobileMax:      num(process.env.RATE_LIMIT_MOBILE_MAX,       60),
    },
  jwt: {
    accessSecret:  process.env.JWT_SECRET         || 'change-in-production',
    refreshSecret: process.env.JWT_REFRESH_SECRET  || 'change-in-production',
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
  },

  chain: {
    // Empty RPC URL = chain disabled. See chainService.isEnabled().
    rpcUrl: process.env.CHAIN_RPC_URL || '',
    network: process.env.CHAIN_NETWORK || 'localhost',
    // Holds BACKEND_ROLE on DIDRegistry/AuditLog. Reads work without it.
    backendPrivateKey: process.env.CHAIN_BACKEND_PRIVATE_KEY || '',
    deploymentFile: process.env.CHAIN_DEPLOYMENT_FILE || '',
    contracts: {
      didRegistry:  process.env.CONTRACT_DID_REGISTRY  || '',
      accessPolicy: process.env.CONTRACT_ACCESS_POLICY || '',
      auditLog:     process.env.CONTRACT_AUDIT_LOG     || '',
    },
    /**
     * Whether the chain is authoritative for access decisions.
     *
     * true  — no chain, no entry. The correct production posture: AccessPolicy
     *         is the only authorisation source, so an unreachable chain denies.
     * false — fall back to the local device public key for signature checks and
     *         skip the on-chain policy gate. Needed for a chain-less dev box and
     *         for the test suite, and it is why every access_event records
     *         `chain_checked`: a row that got in without the chain says so.
     */
    requireChain: process.env.CHAIN_REQUIRED === 'true',
  },

  mqtt: {
    url: process.env.MQTT_URL || '',
    username: process.env.MQTT_USERNAME || '',
    password: process.env.MQTT_PASSWORD || '',
    clientId: process.env.MQTT_CLIENT_ID || 'access-backend',
    holdSeconds: num(process.env.MQTT_HOLD_SECONDS, 5),
  },

  behavior: {
    /**
     * The behaviour engine (Python/FastAPI). Empty = disabled, and every call
     * becomes a no-op: scoring happens after the access decision is already
     * made and recorded, so a missing engine costs alerts, never entry.
     */
    url: process.env.BEHAVIOR_ENGINE_URL || '',
    // Short on purpose — this runs off the critical path, but a hung request
    // should not pile up sockets while someone holds a door open.
    timeoutMs: num(process.env.BEHAVIOR_TIMEOUT_MS, 3000),
  },

  access: {
    // How stale a signed request may be. Long enough for a slow phone and a
    // little clock skew, short enough that a captured request is useless.
    // Signatures are also single-use (access_events.signature is unique), so
    // this bounds the window in which a replay could even be attempted.
    maxRequestAgeSeconds: num(process.env.ACCESS_MAX_REQUEST_AGE, 90),
    maxClockSkewSeconds: num(process.env.ACCESS_MAX_CLOCK_SKEW, 30),
    /**
     * Minimum on-device face-match score. The old endpoint took `faceScore` as
     * optional and ignored it — the log line literally read `face: bypassed`.
     * Set ACCESS_REQUIRE_FACE=false only for hardware-free testing.
     */
    requireFace: process.env.ACCESS_REQUIRE_FACE !== 'false',
    faceThreshold: num(process.env.ACCESS_FACE_THRESHOLD, 0.7),
  },
};
