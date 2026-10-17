// Flaps and crow in the aerodynamics: what a deflected surface does to its stretch of the
// wing, and the wing's maximum lift and stall in each flight configuration (clean, flaps
// down for landing, crow).
//
// A deflected plain flap changes two things about the sections behind it:
//  - their zero-lift angle (down: more negative, so more lift at the same angle of attack),
//    which the lifting line takes as a change of local twist;
//  - their maximum lift (down: higher).
// Both are taken as increments on the clean section, so the clean section model (its Clmax
// by Reynolds number and thickness, station by station) still applies underneath. They come
// from a pair of XFOIL polars at the same Reynolds number, clean and with the flap deflected
// (GDES FLAP), when those are ready and usable; otherwise from thin-aerofoil flap theory with
// an empirical correction (estimateIncrement). See docs/methods.md, "Flaps and crow".

import { analysePolar } from './stall.js'
import { quantiseRe, flapSpec } from './xfoil.js'
import { airfoilPerformance, usableComputedPolar, liftSlopeAt } from './airfoils.js'
import { resolveSurfaces, crowState } from './controlSurfaces.js'

// Effectiveness correction for a real (viscous) plain flap against thin-aerofoil theory, by
// deflection (°): [deflection, factor], linear between, held beyond the ends. It sits under
// the plain-flap correction of USAF DATCOM §6.1.1.1 and matches XFOIL at model Reynolds
// numbers (NACA 2412, 25% flap, Re 200,000: about 0.55 at 20°, 0.43 at 45°), so it errs low: less
// lift from the flap, a higher stall speed.
export const FLAP_CORRECTION = [
  [0, 0.8],
  [10, 0.8],
  [20, 0.6],
  [30, 0.5],
  [45, 0.4],
]
// Section Clmax gained as a fraction of the lift gained at a fixed angle of attack: a plain
// flap stalls the section a few degrees earlier, so it gets less than the full increment.
// XFOIL gives 0.46 at 20° and 0.39 at 45° for the case above.
export const CLMAX_RATIO = 0.45
// The most Clmax a plain flap adds: Raymer's 0.9 for plain and split flaps at landing settings.
export const CLMAX_GAIN_CAP = 0.9


// Thin-aerofoil flap effectiveness τ = -dα_L0/dδ for a hinge at chord fraction `hinge`
// (Glauert, R&M 1095): with x_h = (1 − cos θ_h) / 2, τ = (π − θ_h + sin θ_h) / π. 0.61 for a
// 25% chord flap.
export function flapEffectiveness(hinge) {
  const x = Math.min(0.999, Math.max(0.001, hinge))
  const th = Math.acos(1 - 2 * x)
  return (Math.PI - th + Math.sin(th)) / Math.PI
}

export function flapCorrection(deg) {
  const d = Math.abs(deg)
  const pts = FLAP_CORRECTION
  if (d <= pts[0][0]) return pts[0][1]
  for (let i = 1; i < pts.length; i++) {
    if (d <= pts[i][0]) {
      const t = (d - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0])
      return pts[i - 1][1] + t * (pts[i][1] - pts[i - 1][1])
    }
  }
  return pts.at(-1)[1]
}

// The estimate for a surface hinged at `hinge` (chord fraction) deflected `deflection` degrees
// (+ down), on a section of lift-curve slope `slopePerDeg`: { dAlphaL0 (°), dClMax }.
export function estimateIncrement({ hinge, deflection, slopePerDeg }) {
  const dAlphaL0 = -flapEffectiveness(hinge) * flapCorrection(deflection) * deflection
  const dCl = -slopePerDeg * dAlphaL0
  return { dAlphaL0, dClMax: Math.min(CLMAX_GAIN_CAP, CLMAX_RATIO * dCl), source: 'estimate' }
}

// The increment from two polars at one Reynolds number, clean and deflected: the change in
// Clmax, and the zero-lift angle shift as the mean change in lift over -2° to 3° (where both
// converged) over the clean lift-curve slope. Null if they don't share enough points.
export function polarIncrement(clean, deflected) {
  const c = analysePolar(clean)
  const d = analysePolar(deflected)
  if (!(c.liftSlopePerDeg > 0)) return null
  const at = new Map(clean.alpha.map((a, i) => [a.toFixed(3), clean.cl[i]]))
  let sum = 0
  let n = 0
  deflected.alpha.forEach((a, i) => {
    if (a < -2 - 1e-9 || a > 3 + 1e-9) return
    const v = at.get(a.toFixed(3))
    if (v === undefined) return
    sum += deflected.cl[i] - v
    n++
  })
  if (n < 3) return null
  return { dAlphaL0: -sum / n / c.liftSlopePerDeg, dClMax: d.clMax - c.clMax, source: 'xfoil' }
}

// --- Flight configurations -------------------------------------------------------------------

export const CONFIGURATIONS = {
  clean: { label: 'Clean' },
  flaps: { label: 'Flaps' },
  crow: { label: 'Crow' },
}

// The configurations this wing can fly in, each with the surfaces it deflects:
// [{ id, label, surfaces: [{ id, name, s0, s1, hinge, deflection }] }]. Clean always; flaps
// when there's a flap or flaperon (each down to the landing setting, `controls.landing.flapDown`,
// or its own most down when that's empty, never past its own throw); crow when it's on.
export function flightConfigurations(sampler, controls) {
  const out = [{ id: 'clean', label: CONFIGURATIONS.clean.label, surfaces: [] }]
  if (!sampler) return out
  const placed = resolveSurfaces(sampler, controls?.surfaces ?? []).filter((r) => r.ok)
  const entry = (r, deflection) => ({
    id: r.id,
    name: r.name,
    role: r.role,
    s0: r.s0,
    s1: r.s1,
    hinge: r.hingeFraction((r.s0 + r.s1) / 2),
    deflection,
  })
  const landing = controls?.landing?.flapDown
  const flaps = placed
    .filter((r) => r.role === 'flap' || r.role === 'flaperon')
    .map((r) => entry(r, Math.max(0, Number.isFinite(landing) ? Math.min(landing, r.down) : r.down)))
    .filter((e) => e.deflection > 0)
  if (flaps.length) out.push({ id: 'flaps', label: CONFIGURATIONS.flaps.label, surfaces: flaps })
  const crow = crowState(controls)
  if (crow.enabled) {
    const surfaces = crow.deflections
      .map((d) => {
        const r = placed.find((x) => x.id === d.id)
        return r && d.deflection ? entry(r, d.deflection) : null
      })
      .filter(Boolean)
    if (surfaces.length) out.push({ id: 'crow', label: CONFIGURATIONS.crow.label, surfaces })
  }
  return out
}

// The flap polar a deflected surface wants (its hinge and deflection, rounded as for the cache).
export const surfaceFlap = (e) => flapSpec({ hinge: e.hinge, deflection: e.deflection })

// Each flat span station's change, from the surfaces deflected and their increments (by id):
// (s) => { dAlphaL0, dClMax } or null where nothing is deflected.
export function stationEffects(surfaces, increments) {
  return (s) => {
    const e = surfaces.find((x) => s >= x.s0 - 1e-9 && s <= x.s1 + 1e-9)
    return e ? (increments.get(e.id) ?? null) : null
  }
}

// Performance in one configuration, on top of the clean result (`clean`, from
// performanceWithXfoil). Increments are taken at the Reynolds number of the clean polar (they
// change little with Re), so its polar is reused and only the deflected ones are solved.
// lookup(flap, re) returns the cache entry for the deflected polar, or null if not computed.
// Returns { perf, need: [{ flap, re }], status, surfaces: [{ ...surface, increment }] }:
// status 'computing' while polars are outstanding, 'done' otherwise. The clean
// configuration returns the clean result itself.
export function configurationPerformance(airfoil, wing, clean, config, lookup) {
  if (config.id === 'clean' || !config.surfaces.length) return { ...clean, need: [], surfaces: [] }
  if (!clean?.perf || !wing?.wing?.planform) return { perf: null, need: [], status: null, surfaces: [] }
  const cleanPolar = clean.perf.clMaxSource === 'xfoil' ? clean.perf.polar : null
  const re = cleanPolar?.re ?? quantiseRe(clean.perf.reynolds ?? 200000)
  const slopePerDeg = liftSlopeAt(re)
  const need = []
  const increments = new Map()
  const surfaces = config.surfaces.map((e) => {
    const flap = surfaceFlap(e)
    let inc = null
    if (cleanPolar) {
      const entry = lookup(flap, re)
      if (!entry) need.push({ flap, re })
      else if (entry.ok && usableComputedPolar(entry.polar)) inc = polarIncrement(cleanPolar, entry.polar)
    }
    inc ??= estimateIncrement({ hinge: flap.hinge, deflection: flap.deflection, slopePerDeg })
    increments.set(e.id, inc)
    return { ...e, increment: inc }
  })
  const effects = stationEffects(config.surfaces, increments)
  const perf = airfoilPerformance(airfoil, { ...wing, wing: { ...wing.wing, effects } }, { polar: cleanPolar })
  const status = need.length || clean.status === 'computing' ? 'computing' : 'done'
  return { perf, need, status, surfaces }
}
