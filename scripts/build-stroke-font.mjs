// Extract Hershey Sans 1-stroke (Hershey's Simplex Roman) from the hersheytext package into
// src/data/strokeFont.json, for engraving labels as single-stroke vector lines.
//
// Run with `npm run build-stroke-font` after updating hersheytext. Only the printable ASCII
// range and the few symbols the labels use are kept, scaled so the cap height is 1.
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const svgPath = require.resolve('hersheytext/svg_fonts/HersheySans1.svg')
const svg = readFileSync(svgPath, 'utf8')

const EXTRA = ['°', '×', '–', '·', '±']
const wanted = new Set([...Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)), ...EXTRA])

const unescape = (s) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')

const CAP = 662 // height of the capitals in font units
const r = (v) => Math.round((v / CAP) * 1000) / 1000 // to cap heights

const glyphs = {}
for (const m of svg.matchAll(/<glyph\s+unicode="([^"]*)"[^>]*?horiz-adv-x="([\d.]+)"(?:[^>]*?\sd="([^"]*)")?/g)) {
  const ch = unescape(m[1])
  if (!wanted.has(ch)) continue
  const d = m[3] ?? ''
  if (/[^MLml\d\s.,-]/.test(d)) throw new Error(`Glyph ${ch} has curves; only straight strokes are expected`)
  const strokes = []
  for (const part of d.split(/(?=[Mm])/).filter((s) => s.trim())) {
    const nums = part.replace(/[MLml]/g, ' ').trim().split(/[\s,]+/).map(Number)
    const pts = []
    for (let i = 0; i + 1 < nums.length; i += 2) pts.push(r(nums[i]), r(nums[i + 1]))
    if (pts.length >= 4) strokes.push(pts)
  }
  // The SVG's advance widths don't match the ink (A overhangs its own), so each glyph is
  // moved to start at x = 0 and spaced by its ink width in strokeFont.js
  const xs = strokes.flatMap((s) => s.filter((_, i) => i % 2 === 0))
  const l = xs.length ? Math.min(...xs) : 0
  const round = (v) => Math.round(v * 1000) / 1000
  glyphs[ch] = {
    w: xs.length ? round(Math.max(...xs) - l) : 0, // ink width
    s: strokes.map((st) => st.map((v, i) => (i % 2 === 0 ? round(v - l) : v))), // [x0, y0, x1, y1, ...], baseline at 0
  }
}
const missing = [...wanted].filter((c) => !glyphs[c])
if (missing.length) throw new Error(`Missing glyphs: ${missing.join(' ')}`)

const out = {
  font: 'Hershey Sans 1-stroke (Simplex Roman), from hersheytext (Evil Mad Scientist SVG fonts)',
  notice: [
    'The Hershey Fonts were originally created by Dr. A. V. Hershey while working at the U. S. National Bureau of Standards.',
    'The format of the Font data in this distribution was originally created by James Hurt, Cognition, Inc., 900 Technology Park Drive, Billerica, MA 01821 (mit-eddie!ci-dandelion!hurt).',
  ],
  glyphs,
}
writeFileSync(new URL('../src/data/strokeFont.json', import.meta.url), JSON.stringify(out) + '\n')
console.log(`Wrote ${Object.keys(glyphs).length} glyphs`)
