// Fetch aerofoil coordinates and XFOIL polars from airfoiltools.com and bundle them
// as static JSON for the app (src/data/airfoils.json).
//
// Run with: npm run fetch-airfoils
//
// Requests are made one at a time with a pause between them, to keep the load on
// airfoiltools.com light. A full run makes roughly 7 requests per section; responses
// are cached in scripts/.cache so re-runs are cheap.

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sectionStats, decimate } from '../src/lib/airfoilGeom.js'

const BASE = 'http://airfoiltools.com'
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../src/data/airfoils.json')
const DELAY_MS = 1500
const USER_AGENT = 'wingcalc-data-fetch (build-time, cached, one request at a time)'
const NCRIT = 9
// Reynolds numbers covering RC models from small park flyers to large scale models.
const REYNOLDS = [50000, 100000, 200000, 500000, 1000000]

// airfoiltools id -> display family. Edit this list to add or remove sections.
const SECTIONS = {
  naca: [
    'n0009sm-il',
    'n0012-il',
    'naca0015-il',
    'naca0018-il',
    'naca1408-il',
    'naca1410-il',
    'naca1412-il',
    'naca2408-il',
    'naca2410-il',
    'naca2412-il',
    'naca2415-il',
    'naca2418-il',
    'naca4412-il',
    'naca4415-il',
    'naca4418-il',
    'naca6412-il',
    'naca23012-il',
    'naca23015-il',
  ],
  eppler: [
    'e168-il',
    'e169-il',
    'e180-il',
    'e193-il',
    'e197-il',
    'e205-il',
    'e207-il',
    'e211-il',
    'e212-il',
    'e214-il',
    'e216-il',
    'e222-il',
    'e226-il',
    'e230-il',
    'e374-il',
    'e387-il',
    'e392-il',
    'e393-il',
    'e423-il',
    'e472-il',
    'e474-il',
  ],
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Responses are cached on disk so a re-run (e.g. after tweaking the parser or the
// section list) only requests what it doesn't already have. Delete the folder to refresh.
const CACHE = resolve(dirname(fileURLToPath(import.meta.url)), '.cache')

async function get(url) {
  const file = resolve(CACHE, url.replace(/^https?:\/\//, '').replace(/[^\w.-]+/g, '_'))
  try {
    return await readFile(file, 'utf8')
  } catch {
    // not cached
  }
  // airfoiltools.com answers 403 when requests come too quickly; back off and retry.
  for (let attempt = 0; attempt < 5; attempt++) {
    await sleep(attempt === 0 ? DELAY_MS : 30000 * attempt)
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
    if (res.ok) {
      const text = await res.text()
      await mkdir(CACHE, { recursive: true })
      await writeFile(file, text)
      return text
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
  const naca = id.match(/^n(?:aca)?(\d{4,5})/)
  if (naca) return `NACA ${naca[1]}`
  const epp = id.match(/^e(\d+)/)
  if (epp) return `E${epp[1]}`
  return seligName
}

async function fetchSection(id, family) {
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

async function main() {
  const sections = []
  const failures = []
  for (const [family, ids] of Object.entries(SECTIONS)) {
    for (const id of ids) {
      console.log(`${family}: ${id}`)
      try {
        sections.push(await fetchSection(id, family))
      } catch (e) {
        console.warn(`  FAILED: ${e.message}`)
        failures.push(id)
      }
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
  if (failures.length) {
    console.warn(`Failed: ${failures.join(', ')}`)
    process.exitCode = 1
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
