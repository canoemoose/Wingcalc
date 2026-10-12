// Write the app's icons into public/ from the mark in src/lib/logo.js:
//   favicon.svg           browsers that take an SVG favicon
//   favicon.ico           16, 32 and 48 px, for the rest
//   apple-touch-icon.png  180 px, square (the phone rounds the corners)
//   icon-192.png, icon-512.png  for the web app manifest
// and the README's logo, the icon with the wordmark, into docs/images/:
//   logo-light.png, logo-dark.png  for light and dark pages, at twice size
//
// Run with `npm run build-icons` after changing the mark. The files are committed, so the
// app build doesn't need this step.
import { writeFileSync, mkdirSync, readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inflateSync } from 'node:zlib'
import { createRequire } from 'node:module'
import { Resvg } from '@resvg/resvg-js'
import { iconSvg } from '../src/lib/logo.js'

const require = createRequire(import.meta.url)
const out = new URL('../public/', import.meta.url)
const docs = new URL('../docs/images/', import.meta.url)
mkdirSync(out, { recursive: true })
mkdirSync(docs, { recursive: true })

const png = (size, opts) => new Resvg(iconSvg(size, opts), { fitTo: { mode: 'width', value: size } }).render().asPng()

// An ICO holding PNG images (every current browser and Windows reads these)
function ico(images) {
  const head = Buffer.alloc(6 + 16 * images.length)
  head.writeUInt16LE(0, 0)
  head.writeUInt16LE(1, 2) // icon
  head.writeUInt16LE(images.length, 4)
  let offset = head.length
  images.forEach(({ size, data }, i) => {
    const e = 6 + 16 * i
    head.writeUInt8(size >= 256 ? 0 : size, e)
    head.writeUInt8(size >= 256 ? 0 : size, e + 1)
    head.writeUInt8(0, e + 2) // no palette
    head.writeUInt8(0, e + 3)
    head.writeUInt16LE(1, e + 4) // planes
    head.writeUInt16LE(32, e + 6) // bits per pixel
    head.writeUInt32LE(data.length, e + 8)
    head.writeUInt32LE(offset, e + 12)
    offset += data.length
  })
  return Buffer.concat([head, ...images.map((im) => im.data)])
}

// A WOFF (version 1) font back to the TrueType it wraps: the same tables, each zlib
// compressed, so the renderer, which doesn't read WOFF, can set the wordmark.
function woffToTtf(woff) {
  const num = woff.readUInt16BE(12)
  const flavor = woff.readUInt32BE(4)
  const tables = []
  for (let i = 0; i < num; i++) {
    const e = 44 + 20 * i
    const [tag, offset, compLength, origLength, checksum] = [woff.readUInt32BE(e), woff.readUInt32BE(e + 4), woff.readUInt32BE(e + 8), woff.readUInt32BE(e + 12), woff.readUInt32BE(e + 16)]
    const raw = woff.subarray(offset, offset + compLength)
    tables.push({ tag, checksum, data: compLength < origLength ? inflateSync(raw) : raw })
  }
  let entrySelector = 0
  while (2 ** (entrySelector + 1) <= num) entrySelector++
  const searchRange = 2 ** entrySelector * 16
  const head = Buffer.alloc(12 + 16 * num)
  head.writeUInt32BE(flavor, 0)
  head.writeUInt16BE(num, 4)
  head.writeUInt16BE(searchRange, 6)
  head.writeUInt16BE(entrySelector, 8)
  head.writeUInt16BE(num * 16 - searchRange, 10)
  let offset = head.length
  const bodies = []
  tables.forEach((t, i) => {
    const e = 12 + 16 * i
    head.writeUInt32BE(t.tag, e)
    head.writeUInt32BE(t.checksum, e + 4)
    head.writeUInt32BE(offset, e + 8)
    head.writeUInt32BE(t.data.length, e + 12)
    const padded = Buffer.alloc((t.data.length + 3) & ~3)
    t.data.copy(padded)
    bodies.push(padded)
    offset += padded.length
  })
  return Buffer.concat([head, ...bodies])
}

writeFileSync(new URL('favicon.svg', out), iconSvg(16) + '\n')
writeFileSync(new URL('favicon.ico', out), ico([16, 32, 48].map((size) => ({ size, data: png(size) }))))
writeFileSync(new URL('apple-touch-icon.png', out), png(180, { rx: 0 }))
for (const size of [192, 512]) writeFileSync(new URL(`icon-${size}.png`, out), png(size))

// The README logo: icon, then Wing in semibold and calc lighter, as the page header
const fontDir = mkdtempSync(join(tmpdir(), 'wingcalc-font-'))
const fontFiles = [400, 600].map((w) => {
  const file = join(fontDir, `plex-${w}.ttf`)
  writeFileSync(file, woffToTtf(readFileSync(require.resolve(`@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-${w}-normal.woff`))))
  return file
})
const ICON = 48
const lockup = (ink, width) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${ICON}" viewBox="0 0 ${width} ${ICON}">` +
  iconSvg(ICON).replace('<svg ', `<svg x="0" y="0" `) +
  `<text x="${ICON + 14}" y="${ICON / 2 + 10.5}" font-family="IBM Plex Sans" font-size="30" letter-spacing="-0.6" fill="${ink}">` +
  // The semibold file names its family "IBM Plex Sans SemiBold", so it's asked for by name
  `<tspan font-family="IBM Plex Sans SemiBold">Wing</tspan><tspan fill-opacity="0.62">calc</tspan></text></svg>`
const render = (svg, scale) => new Resvg(svg, { fitTo: { mode: 'zoom', value: scale }, font: { fontFiles, loadSystemFonts: false, defaultFontFamily: 'IBM Plex Sans' } }).render()
// Measure the text at a generous width, then draw it exactly as wide as it is
const ink = render(lockup('#000', 400), 1).getBBox?.()
const width = Math.ceil((ink ? ink.x + ink.width : 190) + 2)
for (const [name, colour] of [
  ['logo-light.png', '#1b1f24'],
  ['logo-dark.png', '#e8eaed'],
]) {
  writeFileSync(new URL(name, docs), render(lockup(colour, width), 2).asPng())
}
console.log(`Wrote the icons to public/ and the README logo (${width} x ${ICON}) to docs/images/`)
