// Build the bundled aerofoil data:
//
//  - src/data/airfoils.json: sections with XFOIL polars, from airfoiltools.com
//  - src/data/uiuc.json: every section in the UIUC Airfoil Coordinates Database
//    (coordinates and measured geometry only, no polars)
//
// Run with: npm run fetch-airfoils  (add -- --uiuc to rebuild only the UIUC catalogue)
//
// Requests are made one at a time with a pause between them, to keep the load light.
// airfoiltools.com takes roughly 7 requests per section; UIUC is two requests in total
// (the coordinate archive and its index page). Responses are cached in scripts/.cache so
// re-runs are cheap.

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { unzipSync, strFromU8 } from 'fflate'
import { sectionStats, decimate, isMultiElement, normaliseChord, chordLine } from '../src/lib/airfoilGeom.js'
import { familyOf, uiucId } from '../src/lib/family.js'

const BASE = 'http://airfoiltools.com'
const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(HERE, '../src/data/airfoils.json')
const OUT_UIUC = resolve(HERE, '../src/data/uiuc.json')
const UIUC_ZIP = 'https://m-selig.ae.illinois.edu/ads/archives/coord_seligFmt.zip'
const UIUC_INDEX = 'https://m-selig.ae.illinois.edu/ads/coord_database.html'
const UIUC_COORD = 'https://m-selig.ae.illinois.edu/ads/coord/'
const DELAY_MS = 1500
const USER_AGENT = 'wingcalc-data-fetch (build-time, cached, one request at a time)'
const NCRIT = 9
// Reynolds numbers covering RC models from small park flyers to large scale models.
const REYNOLDS = [50000, 100000, 200000, 500000, 1000000]

// airfoiltools ids of the sections to bundle with polars. The family (NACA, Eppler or
// other) is worked out from the id. Edit this list to add or remove sections.
const SECTIONS = [
  // NACA
  'n0009sm-il', 'n0012-il', 'naca0015-il', 'naca0018-il', 'naca1408-il', 'naca1410-il',
  'naca1412-il', 'naca2408-il', 'naca2410-il', 'naca2412-il', 'naca2415-il', 'naca2418-il',
  'naca4412-il', 'naca4415-il', 'naca4418-il', 'naca6412-il', 'naca23012-il', 'naca23015-il',
  'naca633618-il',
  // Eppler
  'e61-il', 'e168-il', 'e169-il', 'e180-il', 'e193-il', 'e197-il', 'e205-il', 'e207-il',
  'e211-il', 'e212-il', 'e214-il', 'e216-il', 'e222-il', 'e226-il', 'e230-il', 'e374-il',
  'e387-il', 'e392-il', 'e393-il', 'e423-il', 'e472-il', 'e474-il',
  // Popular RC sections from other families
  'clarky-il', 'usa35b-il', 'raf6-il', 'goe398-il', 'fx63137-il', 's1223-il', 'ch10sm-il',
  's2091-il', 's3010-il', 's3014-il', 's3021-il', 's4083-il', 's6062-il', 's7055-il',
  's7075-il', 's8036-il', 's9000-il', 'sd7003-il', 'sd7032-il', 'sd7037-il', 'sd7043-il',
  'sd7062-il', 'sd7080-il', 'sa7036-il', 'sa7038-il', 'mh30-il', 'mh32-il', 'mh45-il',
  'mh60-il', 'mh61-il', 'rg14-il', 'rg15-il', 'ag03-il', 'ag12-il', 'ag24-il', 'ag35-il',
  'hq2010-il',
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Responses are cached on disk so a re-run (e.g. after tweaking the parser or the
// section list) only requests what it doesn't already have. Delete the folder to refresh.
const CACHE = resolve(HERE, '.cache')

async function get(url, { binary = false } = {}) {
  const file = resolve(CACHE, url.replace(/^https?:\/\//, '').replace(/[^\w.-]+/g, '_'))
  try {
    return binary ? new Uint8Array(await readFile(file)) : await readFile(file, 'utf8')
  } catch {
    // not cached
  }
  // airfoiltools.com answers 403 when requests come too quickly; back off and retry.
  for (let attempt = 0; attempt < 5; attempt++) {
    await sleep(attempt === 0 ? DELAY_MS : 30000 * attempt)
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
    if (res.ok) {
      const body = binary ? new Uint8Array(await res.arrayBuffer()) : await res.text()
      await mkdir(CACHE, { recursive: true })
      await writeFile(file, body)
      return body
    }
    if (res.status !== 403 && res.status !== 429) throw new Error(`HTTP ${res.status} for ${url}`)
    console.warn(`  HTTP ${res.status}, backing off (attempt ${attempt + 1})`)
  }
  throw new Error(`gave up after repeated refusals: ${url}`)
}

function parseSelig(text) {
  const lines = text.split(/\r?\n/)
  const name = lines[0].trim()
  const coords = []
  for (const line of lines.slice(1)) {
    const parts = line.trim().split(/\s+/).map(Number)
    if (parts.length >= 2 && parts.every(Number.isFinite)) coords.push([parts[0], parts[1]])
  }
  return { name, coords }
}

function parsePolarCsv(text) {
  const lines = text.split(/\r?\n/)
  const header = lines.findIndex((l) => l.startsWith('Alpha,'))
  if (header < 0) return null
  const alpha = []
  const cl = []
  for (const line of lines.slice(header + 1)) {
    const [a, c] = line.split(',').map(Number)
    if (Number.isFinite(a) && Number.isFinite(c)) {
      alpha.push(a)
      cl.push(c)
    }
  }
  return alpha.length ? { alpha, cl } : null
}

// "Max thickness 12% at 30% chord. Max camber 2% at 40% chord"
function parseDetails(html) {
  const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')
  const m = text.match(
    /Max thickness ([\d.]+)% at ([\d.]+)% chord\.?\s*Max camber ([\d.]+)% at ([\d.]+)% chord/i,
  )
  const title = html.match(/<h1[^>]*>([^<]+)<\/h1>/i)
  return {
    title: title ? title[1].trim() : null,
    thicknessPct: m ? Number(m[1]) : null,
    thicknessPosPct: m ? Number(m[2]) : null,
    camberPct: m ? Number(m[3]) : null,
    camberPosPct: m ? Number(m[4]) : null,
  }
}

const round = (v, dp) => (v === null || v === undefined ? null : Number(v.toFixed(dp)))

function displayName(id, seligName) {
  // Prefer a tidy name derived from the id (NACA 2412, E205); fall back to the dat header.
  const base = uiucId(id)
  const naca = base.match(/^n(?:aca)?(\d{4,6})(.*)$/)
  if (naca) return `NACA ${naca[1]}${naca[2] ? ` (${naca[2]})` : ''}`
  const epp = base.match(/^e(\d+)(.*)$/)
  if (epp) return `E${epp[1]}${epp[2] ? ` (${epp[2]})` : ''}`
  const header = seligName
    .replace(/\(?[\d.]+\s*%\)?/g, '')
    .replace(/\bair\s*foil\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
  return header && header.length <= 28 ? header : base.toUpperCase()
}

// Coordinates as a flat list of integers (units of 1/10000 chord), to keep the bundle small.
function pack(coords) {
  return coords.flatMap(([x, y]) => [Math.round(x * 10000), Math.round(y * 10000)])
}

async function fetchSection(id) {
  const family = familyOf(id)
  const detailsUrl = `${BASE}/airfoil/details?airfoil=${id}`
  const datUrl = `${BASE}/airfoil/seligdatfile?airfoil=${id}`
  const details = parseDetails(await get(detailsUrl))
  const { name: seligName, coords } = parseSelig(await get(datUrl))
  if (coords.length < 10) throw new Error(`too few coordinates for ${id}`)
  const stats = sectionStats(coords)

  const polars = []
  for (const re of REYNOLDS) {
    const key = `xf-${id}-${re}${NCRIT === 9 ? '' : `-n${NCRIT}`}`
    const url = `${BASE}/polar/csv?polar=${key}`
    try {
      const p = parsePolarCsv(await get(url))
      if (!p) {
        console.warn(`  no polar data at Re ${re}`)
        continue
      }
      // Only the lift curve is used; keep from -4 deg up to keep the bundle small.
      const keep = p.alpha.map((a, i) => i).filter((i) => p.alpha[i] >= -4)
      polars.push({
        re,
        ncrit: NCRIT,
        source: url,
        alpha: keep.map((i) => p.alpha[i]),
        cl: keep.map((i) => round(p.cl[i], 4)),
      })
    } catch (e) {
      console.warn(`  polar Re ${re}: ${e.message}`)
    }
  }

  return {
    id,
    uiuc: uiucId(id),
    family,
    name: displayName(id, seligName),
    description: details.title,
    source: detailsUrl,
    coordinatesSource: datUrl,
    // Published figures from airfoiltools.com where available, else measured from coordinates.
    thicknessPct: details.thicknessPct ?? round(stats.thickness * 100, 2),
    thicknessPosPct: details.thicknessPosPct ?? round(stats.thicknessPos * 100, 1),
    camberPct: details.camberPct ?? round(stats.camber * 100, 2),
    camberPosPct: details.camberPosPct ?? round(stats.camberPos * 100, 1),
    // Measured from coordinates (see src/lib/airfoilGeom.js).
    leRadiusPct: round(stats.leRadius * 100, 3),
    upper125Pct: round(stats.upper125 * 100, 3),
    coords: decimate(coords, 90).map(([x, y]) => [round(x, 5), round(y, 5)]),
    polars,
  }
}

// "a18.dat \ Archer A18 F1C free flight airfoil(original) \ ..." on the UIUC index page
function parseUiucIndex(html) {
  const out = new Map()
  const re = /<a href="coord\/([^"]+)\.dat">[^<]*<\/a>\s*\\\s*([^\\<]*)/gi
  for (const m of html.matchAll(re)) out.set(m[1].toLowerCase(), m[2].replace(/\s+/g, ' ').trim())
  return out
}

async function buildUiuc() {
  console.log('UIUC: coordinate archive and index')
  const zip = unzipSync(await get(UIUC_ZIP, { binary: true }))
  const descriptions = parseUiucIndex(await get(UIUC_INDEX))
  const sections = []
  const skipped = []
  const rescaled = []
  for (const [path, bytes] of Object.entries(zip)) {
    const m = path.match(/([^/]+)\.dat$/i)
    if (!m) continue
    const id = m[1].toLowerCase()
    try {
      const { name, coords: raw } = parseSelig(strFromU8(bytes))
      if (raw.length < 15) throw new Error('too few points')
      // A multi-element set, or a slat whose cove hooks back: either way no upper and lower surface
      if (isMultiElement(raw)) throw new Error('more than one leading edge')
      // Not a closed section at all (NACA-1 is a cowl profile)
      const { length } = chordLine(raw)
      if (Math.hypot(raw[0][0] - raw.at(-1)[0], raw[0][1] - raw.at(-1)[1]) > 0.5 * length) throw new Error('open outline')
      const coords = normaliseChord(raw)
      if (coords !== raw) rescaled.push(id)
      const stats = sectionStats(coords)
      if (!(stats.thickness > 0.005 && stats.thickness < 0.6)) throw new Error('implausible thickness')
      sections.push({
        id,
        family: familyOf(id),
        name: displayName(id, name),
        description: descriptions.get(id) ?? name,
        thicknessPct: round(stats.thickness * 100, 2),
        thicknessPosPct: round(stats.thicknessPos * 100, 1),
        camberPct: round(stats.camber * 100, 2),
        camberPosPct: round(stats.camberPos * 100, 1),
        leRadiusPct: stats.leRadius === null ? null : round(stats.leRadius * 100, 3),
        upper125Pct: round(stats.upper125 * 100, 3),
        pts: pack(decimate(coords, 60)),
      })
    } catch (e) {
      skipped.push(`${id} (${e.message})`)
    }
  }
  sections.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }))
  const out = {
    generated: new Date().toISOString(),
    source: 'UIUC Airfoil Coordinates Database, https://m-selig.ae.illinois.edu/ads/coord_database.html',
    coordUrl: UIUC_COORD,
    packScale: 10000,
    sections,
  }
  await writeFile(OUT_UIUC, JSON.stringify(out) + '\n')
  console.log(`Wrote ${sections.length} UIUC sections to ${OUT_UIUC}`)
  if (rescaled.length) console.log(`Rescaled to unit chord: ${rescaled.join(', ')}`)
  if (skipped.length) console.warn(`Skipped ${skipped.length}: ${skipped.join(', ')}`)
}

async function main() {
  if (process.argv.includes('--uiuc')) return buildUiuc()
  const sections = []
  const failures = []
  for (const id of SECTIONS) {
    console.log(id)
    try {
      sections.push(await fetchSection(id))
    } catch (e) {
      console.warn(`  FAILED: ${e.message}`)
      failures.push(id)
    }
  }
  const out = {
    generated: new Date().toISOString(),
    source: 'airfoiltools.com (coordinates from the UIUC Airfoil Coordinates Database; polars are XFOIL predictions)',
    ncrit: NCRIT,
    reynolds: REYNOLDS,
    sections,
  }
  await mkdir(dirname(OUT), { recursive: true })
  await writeFile(OUT, JSON.stringify(out) + '\n')
  console.log(`Wrote ${sections.length} sections to ${OUT}`)
  await buildUiuc()
  if (failures.length) {
    console.warn(`Failed: ${failures.join(', ')}`)
    process.exitCode = 1
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
