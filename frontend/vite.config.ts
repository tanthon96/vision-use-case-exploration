import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In Docker Compose the frontend container's localhost ≠ the backend service,
// so we allow the target to be overridden via VITE_API_TARGET env var.
// docker-compose sets it to http://backend:8080; native dev defaults to localhost.
const apiTarget = process.env.VITE_API_TARGET ?? 'http://localhost:8080'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
