// Access to the bundled aerofoil data, and the airfoil-dependent part of the performance
// calculation (section Clmax depends on Reynolds number, which depends on stall speed,
// which depends on Clmax).
//
// Two sources:
//  - the polar library (src/data/airfoils.json): sections with XFOIL polars, loaded eagerly
//  - the UIUC catalogue (src/data/uiuc.json): ~1,600 sections, coordinates only, loaded on
//    demand. For these, Clmax is estimated and the lift curve is indicative.

import data from '../data/airfoils.json'
import { analysePolar, ratePolar, rateGeometry, indicativePolar } from './stall.js'
import { generateSection, upperOrdinate, zeroLiftAngle, unpack } from './airfoilGeom.js'
import { stallSpeed, reynolds, WING_CLMAX_FACTOR } from './calc.js'
import { leastSquares } from './fit.js'

export const LIBRARY = data
export const FAMILIES = {
  naca: { label: 'NACA' },
  eppler: { label: 'Eppler' },
  other: { label: 'Other' },
  custom: { label: 'Custom' },
}
export const UIUC_PREFIX = 'uiuc:'

export function sectionsIn(family) {
  return data.sections.filter((s) => s.family === family)
}

export function findSection(id) {
  return data.sections.find((s) => s.id === id) ?? null
}

// The UIUC catalogue, loaded once on first use (a separate chunk in the app build).
let cataloguePromise = null
export function loadCatalogue() {
  cataloguePromise ??= import('../data/uiuc.json').then((m) => m.default ?? m)
  return cataloguePromise
}

const coordCache = new Map()
// Drawing coordinates for a picker entry, unpacked on demand.
export function entryCoords(entry) {
  if (entry.coords) return entry.coords
  let c = coordCache.get(entry.key)
  if (!c) {
    c = unpack(entry.pts)
    coordCache.set(entry.key, c)
  }
  return c
}

// Everything in a family for the picker: polar-backed sections first, then the rest of the
// UIUC catalogue (skipping sections already in the polar library).
export function catalogueFor(family, uiuc) {
  const lib = sectionsIn(family).map((s) => ({
    key: s.id,
    name: s.name,
    description: s.description,
    thicknessPct: s.thicknessPct,
    camberPct: s.camberPct,
    hasPolar: true,
    coords: s.coords,
  }))
  if (!uiuc) return lib
  const covered = new Set(data.sections.map((s) => s.uiuc))
  const rest = uiuc.sections
    .filter((s) => s.family === family && !covered.has(s.id))
    .map((s) => ({
      key: UIUC_PREFIX + s.id,
      name: s.name,
      description: s.description,
      thicknessPct: s.thicknessPct,
      camberPct: s.camberPct,
      hasPolar: false,
      pts: s.pts,
    }))
  return [...lib, ...rest]
}

export function findUiuc(uiuc, key) {
  if (!uiuc || !key?.startsWith(UIUC_PREFIX)) return null
  const id = key.slice(UIUC_PREFIX.length)
  return uiuc.sections.find((s) => s.id === id) ?? null
}

// Polar whose Reynolds number is nearest to re (in log terms).
export function nearestPolar(section, re) {
  if (!section?.polars?.length) return null
  const target = Math.log(re)
  let best = section.polars[0]
  for (const p of section.polars) {
    if (Math.abs(Math.log(p.re) - target) < Math.abs(Math.log(best.re) - target)) best = p
  }
  return best
}

// Linear interpolation in log(Re) through points [{ re, v }] sorted by re, held constant
// beyond the ends.
function interpLogRe(pts, re) {
  if (!pts.length) return null
  if (re <= pts[0].re) return pts[0].v
  if (re >= pts[pts.length - 1].re) return pts[pts.length - 1].v
  for (let i = 1; i < pts.length; i++) {
    if (re <= pts[i].re) {
      const t = (Math.log(re) - Math.log(pts[i - 1].re)) / (Math.log(pts[i].re) - Math.log(pts[i - 1].re))
      return pts[i - 1].v + t * (pts[i].v - pts[i - 1].v)
    }
  }
  return null
}

// Polars that stop at the peak are unreliable for Clmax: XFOIL failing to converge there
// often means the true maximum was never reached.
function usablePolars(section) {
  return section.polars
    .map((p) => ({ re: p.re, ...analysePolar(p) }))
    .filter((p) => p.postStallSpan >= 0.5)
    .sort((a, b) => a.re - b.re)
}

// Section Clmax at a Reynolds number, interpolated linearly in log(Re) between the
// bundled polars and held constant beyond the ends of the range.
export function sectionClMaxAt(section, re) {
  return interpLogRe(
    usablePolars(section).map((p) => ({ re: p.re, v: p.clMax })),
    re,
  )
}

// --- Estimates for sections without polars, calibrated on the polar library ---------

// Features for the Clmax fit: camber, thickness and thickness² (all % chord).
const features = (camberPct, thicknessPct) => [1, camberPct, thicknessPct, thicknessPct * thicknessPct]

let calibration = null
// Per bundled Reynolds number: a least-squares fit of Clmax on camber and thickness, and
// the mean lift-curve slope, across every polar-backed section.
export function libraryCalibration() {
  if (calibration) return calibration
  calibration = data.reynolds.map((re) => {
    const rows = []
    const ys = []
    const slopes = []
    for (const s of data.sections) {
      const p = s.polars.find((q) => q.re === re)
      if (!p) continue
      const m = analysePolar(p)
      if (m.liftSlopePerDeg) slopes.push(m.liftSlopePerDeg)
      if (m.postStallSpan < 0.5) continue
      rows.push(features(s.camberPct, s.thicknessPct))
      ys.push(m.clMax)
    }
    const coef = leastSquares(rows, ys)
    let ss = 0
    rows.forEach((r, i) => {
      const pred = r.reduce((acc, v, j) => acc + v * coef[j], 0)
      ss += (pred - ys[i]) ** 2
    })
    return {
      re,
      coef,
      rms: Math.sqrt(ss / rows.length),
      n: rows.length,
      slope: slopes.reduce((a, b) => a + b, 0) / slopes.length,
    }
  })
  return calibration
}

export function estimateClMax({ camberPct, thicknessPct }, re) {
  const pts = libraryCalibration().map((c) => ({
    re: c.re,
    v: features(camberPct, thicknessPct).reduce((acc, v, j) => acc + v * c.coef[j], 0),
  }))
  // Keep the estimate within the range seen across real sections.
  return Math.min(2.2, Math.max(0.6, interpLogRe(pts, re)))
}

export function liftSlopeAt(re) {
  return interpLogRe(
    libraryCalibration().map((c) => ({ re: c.re, v: c.slope })),
    re,
  )
}

// --- Resolving the selection --------------------------------------------------------

const paramsFrom = (s) => ({
  thickness: s.thicknessPct / 100,
  thicknessPos: s.thicknessPosPct / 100,
  camber: s.camberPct / 100,
  camberPos: s.camberPosPct / 100,
  leRadius: (s.leRadiusPct ?? 0) / 100,
})

// Resolve the user's airfoil selection to drawable coordinates and section parameters.
// selection: { source, id, clMaxOverride?, custom? }; uiuc is the loaded catalogue or null.
// custom: { clMax, thicknessPct, thicknessPosPct, camberPct, camberPosPct, leRadiusPct }
export function resolveAirfoil(selection, uiuc = null) {
  if (selection.source === 'custom') {
    const c = selection.custom
    const params = {
      thickness: c.thicknessPct / 100,
      thicknessPos: c.thicknessPosPct / 100,
      camber: c.camberPct / 100,
      camberPos: c.camberPosPct / 100,
      leRadius: c.leRadiusPct / 100,
    }
    const { coords, valid } = generateSection(params)
    return { kind: 'custom', name: 'Custom section', coords, valid, params, clMax: c.clMax }
  }
  if (selection.id?.startsWith(UIUC_PREFIX)) {
    const s = findUiuc(uiuc, selection.id)
    if (!s) return null
    return {
      kind: 'catalogue',
      name: s.name,
      description: s.description,
      entry: s,
      source: `${uiuc.coordUrl}${s.id}.dat`,
      coords: unpack(s.pts, uiuc.packScale),
      valid: true,
      params: paramsFrom(s),
      upper125: s.upper125Pct / 100,
      clMaxOverride: selection.clMaxOverride ?? null,
    }
  }
  const s = findSection(selection.id)
  if (!s) return null
  return {
    kind: 'library',
    name: s.name,
    description: s.description,
    section: s,
    source: s.source,
    coords: s.coords,
    valid: true,
    params: paramsFrom(s),
  }
}

// Stall speed, Reynolds number, stall character and lift curve for a resolved airfoil.
// clMaxFactor converts section Clmax to wing CLmax (default 0.9; the caller adds sweep).
// Clmax is looked up (or estimated) at the Reynolds number of the stall itself, which needs
// a short fixed-point iteration (converges in a handful of steps).
export function airfoilPerformance(airfoil, { mass, area, chord, clMaxFactor = WING_CLMAX_FACTOR }) {
  if (!airfoil) return null
  const clMaxAt =
    airfoil.kind === 'library'
      ? (re) => sectionClMaxAt(airfoil.section, re)
      : airfoil.kind === 'catalogue' && airfoil.clMaxOverride === null
        ? (re) => estimateClMax({ camberPct: airfoil.params.camber * 100, thicknessPct: airfoil.params.thickness * 100 }, re)
        : () => (airfoil.kind === 'custom' ? airfoil.clMax : airfoil.clMaxOverride)

  let re = 200000
  let sectionClMax = clMaxAt(re)
  let vs = null
  for (let i = 0; i < 8; i++) {
    vs = stallSpeed(mass, area, sectionClMax * clMaxFactor)
    const next = reynolds(vs, chord)
    if (!next) break
    re = next
    sectionClMax = clMaxAt(re)
  }
  const result = {
    sectionClMax,
    wingClMax: sectionClMax * clMaxFactor,
    clMaxFactor,
    clMaxSource: airfoil.kind === 'library' ? 'polar' : airfoil.kind === 'custom' || airfoil.clMaxOverride !== null ? 'entered' : 'estimated',
    stallSpeed: vs,
    reynolds: vs ? re : null,
  }
  const reForCurve = result.reynolds ?? 200000

  if (airfoil.kind === 'library') {
    const polar = nearestPolar(airfoil.section, reForCurve)
    const stall = polar ? ratePolar(polar) : null
    return {
      ...result,
      stall,
      polar,
      curve: polar && stall ? { alpha: polar.alpha, cl: polar.cl, re: polar.re, peak: { alpha: stall.alphaClMax, cl: stall.clMax }, indicative: false } : null,
    }
  }

  const upper125 = airfoil.upper125 ?? upperOrdinate(airfoil.coords, 0.0125)
  const stall = rateGeometry({ ...airfoil.params, upper125, re: result.reynolds })
  const ip = indicativePolar({
    clMax: sectionClMax,
    alphaL0: zeroLiftAngle(airfoil.coords),
    slopePerDeg: liftSlopeAt(reForCurve),
    rating: stall.rating,
  })
  return {
    ...result,
    stall,
    polar: null,
    curve: { alpha: ip.alpha, cl: ip.cl, re: reForCurve, peak: { alpha: ip.alphaClMax, cl: ip.clMax }, indicative: true },
  }
}
