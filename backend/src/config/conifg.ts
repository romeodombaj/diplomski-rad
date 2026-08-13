import dotenv from "dotenv";

// Load .env.development when not in production — production has no .env file, values fall back to the hardcoded defaults below
if (process.env.NODE_ENV !== "production") {
    dotenv.config({ path: "./.env.development" });
}

export const config = {
    port: Number(process.env.PORT) || 5000,
    env: process.env.NODE_ENV || "production",
    defaultTenantId:
        process.env.DEFAULT_TENANT_ID || "213e6988-e62d-47c5-9fe3-3a0331fa0eea",
    rateLimit: {
        windowMs:     Number(process.env.RATE_LIMIT_WINDOW_MS)     || 15 * 60 * 1000,
        max:          Number(process.env.RATE_LIMIT_MAX)            || 300,
        v1Max:        Number(process.env.RATE_LIMIT_V1_MAX)         || 1000,
        authWindowMs: Number(process.env.RATE_LIMIT_AUTH_WINDOW_MS) || 15 * 60 * 1000,
        authMax:      Number(process.env.RATE_LIMIT_AUTH_MAX)       || 10,
    },
  jwt: {
    accessSecret:  process.env.JWT_SECRET         || 'change-in-production',
    refreshSecret: process.env.JWT_REFRESH_SECRET  || 'change-in-production',
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
  },
};
