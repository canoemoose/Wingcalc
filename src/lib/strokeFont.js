// Single-stroke text for engraving labels: Hershey Sans 1-stroke (Hershey's Simplex Roman),
// extracted by scripts/build-stroke-font.mjs. Lasers and routers follow vector lines
// reliably, where DXF TEXT entities depend on the software's own fonts.
//
// Heights are cap heights: h is the height of a capital, baseline at y. Letters are spaced
// by their ink width; digits sit in cells of one width, so numbers line up.
import font from '../data/strokeFont.json'

const GAP = 0.22 // between glyphs, in cap heights
const SPACE = 0.5
const NARROW = 0.2 // the least cell, so I, l and punctuation don't crowd their neighbours
const DIGIT = Math.max(...'0123456789'.split('').map((d) => font.glyphs[d].w))
const isDigit = (ch) => ch >= '0' && ch <= '9'
const glyph = (ch) => font.glyphs[ch] ?? font.glyphs['?']
// Width of one character's cell, before the gap; the glyph is centred in it
const cell = (ch) => (ch === ' ' ? SPACE : isDigit(ch) ? DIGIT : Math.max(NARROW, glyph(ch).w))

// Width of a string at cap height h, ink to ink.
export function textWidth(text, h) {
  const chars = [...String(text)]
  if (!chars.length) return 0
  return (chars.reduce((w, ch) => w + cell(ch), 0) + GAP * (chars.length - 1)) * h
}

// Polylines drawing text with its baseline starting at (x, y), h the cap height.
export function strokeText(text, x, y, h) {
  const out = []
  let cx = 0
  for (const ch of String(text)) {
    const g = glyph(ch)
    const dx = cx + (cell(ch) - g.w) / 2
    for (const s of ch === ' ' ? [] : g.s) {
      const pts = []
      for (let i = 0; i < s.length; i += 2) pts.push([x + (dx + s[i]) * h, y + s[i + 1] * h])
      out.push(pts)
    }
    cx += cell(ch) + GAP
  }
  return out
}
