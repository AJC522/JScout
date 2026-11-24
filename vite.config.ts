import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const apiTarget = `http://127.0.0.1:${process.env.JSCOUT_PORT ?? '4310'}`;

export default defineConfig({
  root: 'src/client',
  plugins: [react(), tailwindcss()],
  // Separate cache per dev-server instance when several run side by side.
  cacheDir: process.env.VITE_CACHE_DIR ?? '../../node_modules/.vite',
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
  },
  server: {
    host: '127.0.0.1',
    port: Number(process.env.VITE_PORT ?? 5173),
    strictPort: true,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: false },
    },
  },
});
