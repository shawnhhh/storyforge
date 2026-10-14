import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const port = process.env.SERVER_PORT ?? env.SERVER_PORT ?? '3001'
  return {
    plugins: [react(), tailwindcss()],
    server: {
      host: '127.0.0.1',
      proxy: { '/api': `http://127.0.0.1:${port}` },
    },
    preview: { host: '127.0.0.1' },
  }
})
