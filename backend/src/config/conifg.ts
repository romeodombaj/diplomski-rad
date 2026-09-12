import dotenv from "dotenv";

if (process.env.NODE_ENV !== "production") {
    dotenv.config({ path: "./.env.development" });
}

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
        mobileWindowMs: num(process.env.RATE_LIMIT_MOBILE_WINDOW_MS, 60 * 1000),
        mobileMax:      num(process.env.RATE_LIMIT_MOBILE_MAX,       60),
        proximityWindowMs: num(process.env.RATE_LIMIT_PROXIMITY_WINDOW_MS, 60 * 1000),
        proximityMax:      num(process.env.RATE_LIMIT_PROXIMITY_MAX,       240),
    },
  jwt: {
    accessSecret:  process.env.JWT_SECRET         || 'change-in-production',
    refreshSecret: process.env.JWT_REFRESH_SECRET  || 'change-in-production',
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
  },

  chain: {
    rpcUrl: process.env.CHAIN_RPC_URL || '',
    network: process.env.CHAIN_NETWORK || 'localhost',
    backendPrivateKey: process.env.CHAIN_BACKEND_PRIVATE_KEY || '',
    deploymentFile: process.env.CHAIN_DEPLOYMENT_FILE || '',
    contracts: {
      didRegistry:  process.env.CONTRACT_DID_REGISTRY  || '',
      accessPolicy: process.env.CONTRACT_ACCESS_POLICY || '',
      auditLog:     process.env.CONTRACT_AUDIT_LOG     || '',
    },
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
    url: process.env.BEHAVIOR_ENGINE_URL || '',
    timeoutMs: num(process.env.BEHAVIOR_TIMEOUT_MS, 3000),
  },

  access: {
    maxRequestAgeSeconds: num(process.env.ACCESS_MAX_REQUEST_AGE, 90),
    maxClockSkewSeconds: num(process.env.ACCESS_MAX_CLOCK_SKEW, 30),
    requireFace: process.env.ACCESS_REQUIRE_FACE !== 'false',
    faceThreshold: num(process.env.ACCESS_FACE_THRESHOLD, 0.7),
  },

  devices: {
    scanSubnet: process.env.DEVICE_SCAN_SUBNET || '',
  },

  proximity: {
    levels: num(process.env.PROXIMITY_LEVELS, 12),
    maxAgeSeconds: num(process.env.PROXIMITY_MAX_AGE, 10),
    maxClockSkewSeconds: num(process.env.PROXIMITY_MAX_CLOCK_SKEW, 30),
  },
};
