import { execSync } from 'child_process'
import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

let lastCommit = ''
try {
  lastCommit = execSync('git log -1 --format="%h · %ar"').toString().trim()
} catch {
  // no git or no commits
}

// Backend dev port — keep in sync with backend/.env.development (PORT)
const BACKEND_PORT = process.env.BACKEND_PORT || '5001'
const backendTarget = `http://localhost:${BACKEND_PORT}`

export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_LAST_COMMIT': JSON.stringify(lastCommit),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: backendTarget,
        changeOrigin: true,
      },
      '/auth': {
        target: backendTarget,
        changeOrigin: true,
      },
    },
  },
})
