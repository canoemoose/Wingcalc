import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// Standalone app build (index.html -> dist/). Relative base so dist/ can be hosted anywhere.
export default defineConfig({
  base: './',
  plugins: [vue()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
  },
})
