import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const ortDist = fileURLToPath(new URL('./node_modules/onnxruntime-web/dist/', import.meta.url));

// Cross-origin isolation enables multi-threaded WebAssembly (SharedArrayBuffer).
// Production sets the same headers in public/_headers.
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  // Resolve the real path so worker URLs (import.meta.url) and the dev-server
  // root agree even when the project folder is reached through a link.
  root: fs.realpathSync.native(process.cwd()),
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // The "extern wasm" builds load their glue + binary from paths we control
      // (public/bin), instead of bundling a 28 MB file into the worker chunk.
      // Native WebGPU execution provider, paired with ort-wasm-simd-threaded.asyncify.wasm
      'ort-webgpu': `${ortDist}ort.webgpu.min.mjs`,
      'ort-wasm': `${ortDist}ort.wasm.min.mjs`,
    },
  },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 2500,
  },
  server: { headers: isolation },
  preview: { headers: isolation },
});
