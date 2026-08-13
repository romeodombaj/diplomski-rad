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
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
      '/auth': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
})
