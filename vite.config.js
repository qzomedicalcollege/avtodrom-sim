import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    host: true,
    port: 5173,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: 'index.html',
        game3d: 'index3d.html',
      },
    },
  },
})