// Access to the bundled aerofoil data, and the airfoil-dependent part of the performance
// calculation (section Clmax depends on Reynolds number, which depends on stall speed,
// which depends on Clmax).
//
// Two sources:
//  - the polar library (src/data/airfoils.json): sections with XFOIL polars, loaded eagerly
//  - the UIUC catalogue (src/data/uiuc.json): ~1,600 sections, coordinates only, loaded on
//    demand. For these, Clmax is estimated and the lift curve is indicative.

import data from '../data/airfoils.json'
import { analysePolar, ratePolar, rateGeometry, indicativePolar, spanwiseStall, sharper } from './stall.js'
import { generateSection, upperOrdinate, zeroLiftAngle, unpack, isMultiElement } from './airfoilGeom.js'
import { stallSpeed, reynolds, WING_CLMAX_FACTOR, NU_SEA_LEVEL } from './calc.js'
import { leastSquares } from './fit.js'
import { quantiseRe, polarSegments, COMPARE_THRESHOLDS } from './xfoil.js'
import { liftingLine, firstStall, clDistribution, progressiveStall } from './liftingLine.js'

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

// Whether a UIUC entry is a multi-element set (slat, main and flap in one file, such as
// 30P-30N). Nothing here can model one: the stats, XFOIL and the ribs all assume a single
// closed section. Worked out once per entry.
const multiElementCache = new WeakMap()
export function isMultiElementEntry(s, packScale = 10000) {
  let m = multiElementCache.get(s)
  if (m === undefined) {
    m = isMultiElement(unpack(s.pts, packScale))
    multiElementCache.set(s, m)
  }
  return m
}

// Everything in a family for the picker: polar-backed sections first, then the rest of the
// UIUC catalogue (skipping sections already in the polar library, and multi-element sets).
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
    .filter((s) => s.family === family && !covered.has(s.id) && !isMultiElementEntry(s, uiuc.packScale))
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
// selection: { source, id, custom? }; uiuc is the loaded catalogue or null.
// custom: { thicknessPct, thicknessPosPct, camberPct, camberPosPct, leRadiusPct }
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
    return { kind: 'custom', name: 'Custom section', coords, valid, params }
  }
  if (selection.id?.startsWith(UIUC_PREFIX)) {
    const s = findUiuc(uiuc, selection.id)
    if (!s) return null
    // A multi-element set isn't offered, but an older saved project may still name one
    const multiElement = isMultiElementEntry(s, uiuc.packScale)
    return {
      kind: 'catalogue',
      name: s.name,
      description: s.description,
      entry: s,
      source: `${uiuc.coordUrl}${s.id}.dat`,
      coords: unpack(s.pts, uiuc.packScale),
      valid: !multiElement,
      multiElement,
      params: paramsFrom(s),
      upper125: s.upper125Pct / 100,
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

// Section Clmax at a Reynolds number and thickness (fraction of chord). A thinner or thicker
// section than the aerofoil's own (thickness taper) is credited with the change the library
// fit predicts for that thickness at the same camber; the base value comes from the polars
// or the estimate as usual.
// With `computed` (an XFOIL polar at one Reynolds number), the base is its Clmax, moved by the
// change the instant model (bundled polars or estimate) predicts between that Re and this one,
// so smaller-chord stations still lose Clmax to their lower Re.
export function sectionModel(airfoil, computed = null) {
  const camberPct = airfoil.params.camber * 100
  const baseT = airfoil.params.thickness
  const instant =
    airfoil.kind === 'library'
      ? (re) => sectionClMaxAt(airfoil.section, re)
      : (re) => estimateClMax({ camberPct, thicknessPct: baseT * 100 }, re)
  const base = computed ? (re) => computed.clMax + instant(re) - instant(computed.re) : instant
  const clMaxAt = (re, thickness = baseT) => {
    const v = base(re)
    if (!Number.isFinite(thickness) || Math.abs(thickness - baseT) < 1e-6) return v
    const delta =
      estimateClMax({ camberPct, thicknessPct: thickness * 100 }, re) - estimateClMax({ camberPct, thicknessPct: baseT * 100 }, re)
    return Math.max(0.3, v + delta)
  }
  // Section lift-curve slope per radian, from the library's mean at this Reynolds number.
  const a0At = (re) => (liftSlopeAt(re) * 180) / Math.PI
  return { clMaxAt, a0At }
}

const MIN_RE = 20000 // below this the bundled data says nothing useful; hold it there
// How far (degrees of wing angle of attack) a stalled section behind a deflected flap is taken
// to hold its maximum lift while the rest of the wing goes on to its own stall.
export const PROGRESSIVE_STALL_DEG = 3

// The wing's maximum lift from the spanwise lift distribution (lifting line) at a stall
// speed: each station's Reynolds number, thickness and twist give its own Clmax and share of
// the lift, and the wing stalls when the first station reaches its Clmax.
// planform: { atY, semiSpan } from projectedSampler; area is the projected area.
// effects(s), if given, is the change a deflected flap or aileron makes at flat span station s
// ({ dAlphaL0 (°), dClMax } or null; flaps.js): the zero-lift angle shift enters as twist (a
// flap down is wash-in), and Clmax moves by the increment.
export function wingStallAt(model, planform, { span, area, speed, effects = null }) {
  const at = (eta) => planform.atY(eta * planform.semiSpan)
  const reOf = (c) => Math.max(MIN_RE, (speed * c) / NU_SEA_LEVEL)
  const effectAt = (p) => (effects && p.s !== null && p.s !== undefined ? effects(p.s) : null)
  const ll = liftingLine({
    span,
    area,
    station: (eta) => {
      const p = at(eta)
      const twist = p.twist + (effectAt(p)?.dAlphaL0 ?? 0)
      return { c: p.c, twist: (twist * Math.PI) / 180, a0: model.a0At(reOf(p.c)) }
    },
  })
  if (!ll) return null
  const clMaxOf = (eta) => {
    const p = at(eta)
    const v = model.clMaxAt(reOf(p.c), p.thickness)
    const e = effectAt(p)
    return e ? Math.max(0.2, v + e.dClMax) : v // a long way up leaves the section some lift
  }
  if (effects) {
    const deflected = (eta) => !!effectAt(at(eta))
    // Stations within half a chord of a deflected surface count with it: the lifting line
    // spreads the jump in lift at a flap's end over a few stations, which would otherwise make
    // the clean section just beside it the first to stall.
    const near = (eta) => {
      const p = at(eta)
      if (p.s === null || p.s === undefined) return false
      return [0, -p.c / 2, p.c / 2].some((d) => !!effects(p.s + d))
    }
    const st = progressiveStall(ll, clMaxOf, near, (PROGRESSIVE_STALL_DEG * Math.PI) / 180)
    if (!st) return null
    const dist = ll.stations.map((d, i) => {
      const p = at(d.eta)
      return { eta: d.eta, s: p.s, c: d.c, cl: st.cl[i], clMax: clMaxOf(d.eta), deflected: deflected(d.eta) }
    })
    return { CLmax: st.CLmax, onsetEta: st.eta, ll, distribution: dist }
  }
  const st = firstStall(ll, clMaxOf)
  if (!st) return null
  const dist = clDistribution(ll, st.CLmax).map((d) => {
    const p = at(d.eta)
    return { eta: d.eta, s: p.s, c: d.c, cl: d.cl, clMax: clMaxOf(d.eta) }
  })
  return { CLmax: st.CLmax, onsetEta: st.eta, ll, distribution: dist }
}

// Stall speed, Reynolds number, stall character and lift curve for a resolved airfoil.
// clMaxFactor converts section Clmax to wing CLmax (default 0.9; the caller adds sweep).
// Clmax is looked up (or estimated) at the Reynolds number of the stall itself, which needs
// a short fixed-point iteration (converges in a handful of steps).
// With `wing` ({ planform, span, sweepCos, effects? }), wing CLmax comes from the lifting line
// instead of the fixed factor, so taper, washout and thickness taper all count; `effects` adds
// deflected flaps or ailerons (flaps.js configurationPerformance).
// With `polar` (an XFOIL polar computed in the browser, at one Reynolds number), the section
// Clmax, the stall rating and the lift curve all come from it instead; see
// performanceWithXfoil. The lifting line still varies Clmax by station (sectionModel).
export function airfoilPerformance(airfoil, { mass, area, chord, clMaxFactor = WING_CLMAX_FACTOR, wing = null }, { polar: computed = null } = {}) {
  if (!airfoil) return null
  const computedStall = computed ? ratePolar(computed) : null
  const model = sectionModel(airfoil, computed && { clMax: computedStall.clMax, re: computed.re })
  const clMaxAt = computed ? () => computedStall.clMax : (re) => model.clMaxAt(re)

  let re = 200000
  let sectionClMax = clMaxAt(re)
  let vs = stallSpeed(mass, area, sectionClMax * clMaxFactor)
  let spanwise = null
  let wingClMax = sectionClMax * clMaxFactor
  for (let i = 0; i < 12; i++) {
    if (wing?.planform && vs) {
      const w = wingStallAt(model, wing.planform, { span: wing.span, area, speed: vs, effects: wing.effects })
      if (w && w.CLmax > 0) {
        spanwise = w
        wingClMax = w.CLmax * (wing.sweepCos ?? 1)
      }
    }
    const next = reynolds(vs, chord)
    if (!next) break
    re = next
    sectionClMax = clMaxAt(re)
    if (!spanwise) wingClMax = sectionClMax * clMaxFactor
    const v = stallSpeed(mass, area, wingClMax)
    if (v && vs && Math.abs(v - vs) < 1e-4 * vs) {
      vs = v
      break
    }
    vs = v
  }
  const result = {
    sectionClMax,
    wingClMax,
    clMaxFactor: spanwise ? wingClMax / sectionClMax : clMaxFactor,
    method: spanwise ? 'lifting-line' : 'factor',
    spanwise,
    clMaxSource: computed ? 'xfoil' : airfoil.kind === 'library' ? 'polar' : 'estimated',
    stallSpeed: vs,
    reynolds: vs ? re : null,
  }
  const reForCurve = result.reynolds ?? 200000

  // The section's character, adjusted for where along the span the wing stalls first.
  const withSpan = (stall) => {
    if (!stall || !spanwise) return stall
    const sp = spanwiseStall(spanwise.onsetEta)
    return { ...stall, sectionRating: stall.rating, rating: sp.sharper ? sharper(stall.rating) : stall.rating, spanwise: sp }
  }

  if (computed) return { ...result, ...computedCurve(airfoil, computed, computedStall), stall: withSpan(computedStall) }

  if (airfoil.kind === 'library') {
    const polar = nearestPolar(airfoil.section, reForCurve)
    const stall = withSpan(polar ? ratePolar(polar) : null)
    return {
      ...result,
      stall,
      polar,
      curve: polar && stall ? { alpha: polar.alpha, cl: polar.cl, re: polar.re, peak: { alpha: stall.alphaClMax, cl: stall.clMax }, indicative: false } : null,
    }
  }

  const upper125 = airfoil.upper125 ?? upperOrdinate(airfoil.coords, 0.0125)
  const sectionStall = rateGeometry({ ...airfoil.params, upper125, re: result.reynolds })
  const stall = withSpan(sectionStall)
  const ip = indicativePolar({
    clMax: sectionClMax,
    alphaL0: zeroLiftAngle(airfoil.coords),
    slopePerDeg: liftSlopeAt(reForCurve),
    rating: sectionStall.rating,
  })
  return {
    ...result,
    stall,
    polar: null,
    curve: { alpha: ip.alpha, cl: ip.cl, re: reForCurve, peak: { alpha: ip.alphaClMax, cl: ip.clMax }, indicative: true },
  }
}

// --- Polars computed in the browser (XFOIL) ---------------------------------------------

// A computed polar is usable when it has a fair number of converged points and either a
// converged point past the peak, or converged points right up to the peak with every point
// after it failing. XFOIL losing convergence there usually means the flow has separated, so
// that peak is taken as the stall (ratePolar then rates it with low confidence). A polar
// that merely ran out of range at its peak is not usable.
export function usableComputedPolar(polar) {
  if (!polar || polar.alpha.length < 8) return false
  const m = analysePolar(polar)
  if (m.postStallSpan >= 0.5) return true
  const after = (polar.failed ?? []).filter((a) => a > m.alphaClMax)
  return m.alphaClMax >= 4 && after.length >= 2 && after[0] - m.alphaClMax <= polar.step * 1.5
}

// The lift curve for a computed polar and, for library sections, the bundled comparison.
function computedCurve(airfoil, polar, stall) {
  const sectionClMax = stall.clMax
  const result = {
    polar,
    curve: {
      alpha: polar.alpha,
      cl: polar.cl,
      re: polar.re,
      segments: polarSegments(polar),
      peak: { alpha: stall.alphaClMax, cl: stall.clMax },
      indicative: false,
      computed: true,
    },
  }
  // For library sections, compare with the bundled airfoiltools.com data at the same Re.
  if (airfoil.kind === 'library') {
    const bundled = sectionClMaxAt(airfoil.section, polar.re)
    if (bundled !== null) {
      const differs = Math.abs(sectionClMax - bundled) > COMPARE_THRESHOLDS.clMax
      result.reference = { clMax: bundled, differs }
      // Drawn faintly behind the computed curve when they differ: the bundled polar nearest
      // this Re (the Clmax above is interpolated between bundled polars, so its Re may differ).
      const near = differs ? nearestPolar(airfoil.section, polar.re) : null
      if (near) result.curve.reference = { alpha: near.alpha, cl: near.cl, re: near.re }
    }
  }
  return result
}

// Performance using XFOIL polars computed in the browser, where available. Polars are
// solved at Reynolds numbers on a grid (quantiseRe); lookup(re) returns the cache entry for
// this airfoil at that grid Re: { ok, polar } once computed, or null if not computed yet.
// Starting from the instant answer (bundled polar or estimate), this follows the stall
// Reynolds number: solve at the estimated stall Re, recompute stall speed and Re from the
// computed Clmax, and solve again if that lands on a different grid point (at most 4).
// Returns { perf, need, status }: need is the grid Re still to solve (or null), status is
// 'computing', 'done' or 'failed' (computed polar unusable: perf stays the instant answer).
export function performanceWithXfoil(airfoil, wing, lookup) {
  const instant = airfoilPerformance(airfoil, wing)
  if (!instant) return { perf: null, need: null, status: null }
  let perf = instant
  let re = instant.reynolds ?? 200000
  const tried = new Set()
  for (let i = 0; i < 4; i++) {
    const q = quantiseRe(re)
    if (tried.has(q)) break
    tried.add(q)
    const entry = lookup(q)
    if (!entry) return { perf, need: q, status: 'computing' }
    if (!entry.ok || !usableComputedPolar(entry.polar)) {
      return perf === instant ? { perf, need: null, status: 'failed' } : { perf, need: null, status: 'done' }
    }
    perf = airfoilPerformance(airfoil, wing, { polar: entry.polar })
    re = perf.reynolds ?? q
  }
  return { perf, need: null, status: 'done' }
}
