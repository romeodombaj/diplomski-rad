import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    env: {
      NODE_ENV: 'test',
      // The suite drives /mobile far harder than any real phone does, all from
      // 127.0.0.1. Raised rather than disabled so the limiter middleware still
      // runs in every test — only its ceiling moves.
      RATE_LIMIT_MOBILE_MAX: '100000',
    },
  },
})
