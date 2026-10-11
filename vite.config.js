import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// Standalone app build (index.html -> dist/). Relative base so dist/ can be hosted anywhere.
export default defineConfig({
  base: './',
  plugins: [vue()],
  // The XFOIL worker is an ES module (it imports the WebXFOIL glue, which locates its .wasm
  // via import.meta.url).
  worker: { format: 'es' },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
  },
})
