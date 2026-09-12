import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    env: {
      NODE_ENV: 'test',
      RATE_LIMIT_MOBILE_MAX: '100000',
    },
  },
})
