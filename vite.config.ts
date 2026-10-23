import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const backend = env.VITE_BACKEND_URL || 'http://localhost:8000'

  return {
    plugins: [react()],
    server: {
      // 5173 is Vite's default (likely used by the Operator Dashboard), so both can run at once.
      port: 5174,
      // Forward API calls to FastAPI. The browser only ever talks to this dev server, so the backend's
      // CORS list (only :5173 and :3000) doesn't need changing, and a phone on the same Wi-Fi can use
      // the app (`npm run dev -- --host`).
      proxy: {
        '/api': { target: backend, changeOrigin: true },
        '/health': { target: backend, changeOrigin: true },
      },
    },
  }
})
