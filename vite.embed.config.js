import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// Embeddable build: a single self-contained script that registers <wing-calc>.
// Vue, the styles and the aerofoil data are all bundled in.
export default defineConfig({
  plugins: [vue()],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir: 'dist-embed',
    lib: {
      entry: 'src/embed.js',
      name: 'WingCalc',
      formats: ['es', 'iife'],
      fileName: (format) => (format === 'es' ? 'wingcalc.mjs' : 'wingcalc.js'),
    },
  },
})
