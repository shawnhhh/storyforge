import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv } from 'vite'
import { resolve } from 'node:path'

export default defineConfig(({ mode, command }) => {
  // Production builds and isolated browser tests never load application secrets.
  // Local development may still read SERVER_PORT from the user's env file.
  const isolated = command === 'build' || Boolean(process.env.E2E_BASE_URL) || process.env.STORYFORGE_BETA === '1'
  const env = isolated ? {} : loadEnv(mode, process.cwd(), 'SERVER_PORT')
  const port = process.env.SERVER_PORT ?? env.SERVER_PORT ?? '3001'
  return {
    plugins: [react(), tailwindcss()],
    cacheDir: 'work/vite-cache',
    envDir: isolated ? false : undefined,
    // This entry is reached through the lazy chapter editor. Prebundle it before
    // the first edit so dependency discovery cannot reload an active draft.
    optimizeDeps: { include: ['@tiptap/pm/history'] },
    server: {
      host: '127.0.0.1',
      // Trace snapshots contain HTML. Watching generated artifacts can reload a
      // live editor/form while the test that wrote the snapshot is still running.
      watch: { ignored: ['work', 'data', 'dist'].map(directory => resolve(process.cwd(), directory, '**')) },
      proxy: { '/api': `http://127.0.0.1:${port}` },
    },
    preview: { host: '127.0.0.1', proxy: { '/api': `http://127.0.0.1:${port}` } },
  }
})
