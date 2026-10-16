import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = process.env.E2E_BASE_URL ? {} : loadEnv(mode, process.cwd(), 'SERVER_PORT')
  const port = process.env.SERVER_PORT ?? env.SERVER_PORT ?? '3001'
  return {
    plugins: [react(), tailwindcss()],
    envDir: process.env.E2E_BASE_URL ? false : undefined,
    // This entry is reached through the lazy chapter editor. Prebundle it before
    // the first edit so dependency discovery cannot reload an active draft.
    optimizeDeps: { include: ['@tiptap/pm/history'] },
    server: {
      host: '127.0.0.1',
      proxy: { '/api': `http://127.0.0.1:${port}` },
    },
    preview: { host: '127.0.0.1' },
  }
})
