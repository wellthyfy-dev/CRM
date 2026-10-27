import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Read VITE_* values from the repo-root .env
  envDir: path.resolve(here, '../..'),
  resolve: { alias: { '@': path.resolve(here, 'src') } },
  server: { port: 5173, strictPort: true },
  build: { sourcemap: true, chunkSizeWarningLimit: 1500 },
});
