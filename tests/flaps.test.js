import { describe, it, expect } from 'vitest'
import {
  flapEffectiveness,
  flapCorrection,
  estimateIncrement,
  polarIncrement,
  flightConfigurations,
  configurationPerformance,
  stationEffects,
  CLMAX_GAIN_CAP,
} from '../src/lib/flaps.js'
import { defaultState } from '../src/lib/projects.js'
import { resolveAirfoil, performanceWithXfoil, airfoilPerformance } from '../src/lib/airfoils.js'
import { wingGeometry } from '../src/lib/calc.js'
import { wingSampler, projectedSampler } from '../src/lib/wing.js'
import { newSurface, defaultControls } from '../src/lib/controlSurfaces.js'
import { liftingLine, firstStall, progressiveStall } from '../src/lib/liftingLine.js'

// The default 1.4 m sport wing (one 0.7 m panel), with surfaces given as [role, from, to]
function setup(surfaces = [], controls = {}) {
  const s = defaultState()
  const input = s.input
  const airfoil = resolveAirfoil(s.airfoil)
  const sampler = wingSampler(input, airfoil.params.thickness)
  const pid = input.panels[0].id
  const list = surfaces.map(([role, from, to], i) => newSurface(role, pid, from, to, i + 1))
  const ctl = { ...defaultControls(), ...controls, surfaces: list }
  const g = wingGeometry({ ...input, mode: 'panels' })
  const wing = {
    mass: input.mass,
    area: g.projectedArea,
    chord: g.mac,
    clMaxFactor: 0.9,
    wing: { planform: projectedSampler(sampler), span: g.span, sweepCos: 1 },
  }
  return { airfoil, sampler, controls: ctl, wing }
}

const failed = () => ({ ok: false, error: 'test' })

describe('flap theory', () => {
  it('gives thin-aerofoil flap effectiveness (Glauert)', () => {
    expect(flapEffectiveness(0.75)).toBeCloseTo(0.609, 3) // 25% flap
    expect(flapEffectiveness(0.5)).toBeCloseTo(0.5 + 1 / Math.PI, 6) // 50% flap
    expect(flapEffectiveness(0.999)).toBeLessThan(0.05)
  })

  it('corrects less as the flap goes further, the same up or down', () => {
    expect(flapCorrection(5)).toBe(0.8)
    expect(flapCorrection(20)).toBeCloseTo(0.6, 9)
    expect(flapCorrection(-20)).toBe(flapCorrection(20))
    expect(flapCorrection(60)).toBe(0.4)
    expect(flapCorrection(25)).toBeCloseTo(0.55, 9)
  })

  it('estimates the increment: down moves alpha_L0 negative and adds Clmax, capped; up the reverse', () => {
    const slopePerDeg = 0.1
    const down = estimateIncrement({ hinge: 0.75, deflection: 20, slopePerDeg })
    expect(down.dAlphaL0).toBeCloseTo(-0.609 * 0.6 * 20, 2)
    expect(down.dClMax).toBeCloseTo(0.45 * -slopePerDeg * down.dAlphaL0, 9)
    const up = estimateIncrement({ hinge: 0.75, deflection: -20, slopePerDeg })
    expect(up.dAlphaL0).toBeCloseTo(-down.dAlphaL0, 9)
    expect(up.dClMax).toBeCloseTo(-down.dClMax, 9)
    const big = estimateIncrement({ hinge: 0.5, deflection: 70, slopePerDeg: 0.11 })
    expect(big.dClMax).toBe(CLMAX_GAIN_CAP)
  })

  it('reads the increment from a pair of polars at one Reynolds number', () => {
    const alpha = [-4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
    const clean = { alpha, cl: alpha.map((a) => Math.min(0.2 + 0.1 * a, 1.2 - 0.05 * Math.max(0, a - 10))) }
    // 0.6 more lift at every angle up to its stall, which is 0.3 higher
    const flapped = { alpha, cl: alpha.map((a) => Math.min(0.8 + 0.1 * a, 1.5 - 0.05 * Math.max(0, a - 7))) }
    const inc = polarIncrement(clean, flapped)
    expect(inc.dAlphaL0).toBeCloseTo(-6, 6)
    expect(inc.dClMax).toBeCloseTo(0.3, 6)
    expect(inc.source).toBe('xfoil')
    // Not enough shared points in the linear range
    expect(polarIncrement(clean, { alpha: [8, 9, 10], cl: [1.3, 1.4, 1.5] })).toBeNull()
  })
})

describe('flight configurations', () => {
  it('offers clean only without flaps, and flaps when there is a flap or flaperon', () => {
    expect(flightConfigurations(setup([['aileron', 0.3, 0.68]]).sampler, setup([['aileron', 0.3, 0.68]]).controls).map((c) => c.id)).toEqual(['clean'])
    const { sampler, controls } = setup([['flap', 0.01, 0.28], ['aileron', 0.3, 0.68]])
    const list = flightConfigurations(sampler, controls)
    expect(list.map((c) => c.id)).toEqual(['clean', 'flaps'])
    expect(list[1].surfaces).toHaveLength(1)
    expect(list[1].surfaces[0]).toMatchObject({ name: 'F1', deflection: 45 })
    expect(list[1].surfaces[0].hinge).toBeCloseTo(0.75, 6)
    expect(flightConfigurations(null, controls).map((c) => c.id)).toEqual(['clean'])
    const fa = setup([['flaperon', 0.05, 0.68]])
    expect(flightConfigurations(fa.sampler, fa.controls)[1].surfaces[0].deflection).toBe(30)
  })

  it('takes the landing flap setting, never past a flap own throw', () => {
    const { sampler, controls } = setup([['flap', 0.01, 0.28]])
    const at = (flapDown) => flightConfigurations(sampler, { ...controls, landing: { flapDown } })
    expect(at(20)[1].surfaces[0].deflection).toBe(20)
    expect(at(60)[1].surfaces[0].deflection).toBe(45)
    expect(at(0).map((c) => c.id)).toEqual(['clean'])
  })

  it('offers crow only when it is on, with ailerons up and flaps down', () => {
    const { sampler, controls } = setup([['flap', 0.01, 0.28], ['aileron', 0.3, 0.68]])
    expect(flightConfigurations(sampler, controls).some((c) => c.id === 'crow')).toBe(false)
    const on = { ...controls, crow: { enabled: true, aileronUp: 25, flapDown: 40 } }
    const crow = flightConfigurations(sampler, on).find((c) => c.id === 'crow')
    expect(crow.surfaces.map((e) => [e.name, e.deflection])).toEqual([
      ['F1', 40],
      ['A1', -20], // the aileron's own most up
    ])
  })

  it('applies an increment along a surface only', () => {
    const fx = stationEffects([{ id: 1, s0: 0.1, s1: 0.3 }], new Map([[1, { dAlphaL0: -5, dClMax: 0.3 }]]))
    expect(fx(0.05)).toBeNull()
    expect(fx(0.2)).toEqual({ dAlphaL0: -5, dClMax: 0.3 })
    expect(fx(0.35)).toBeNull()
  })
})

describe('performance by configuration', () => {
  const wingWith = () => {
    const t = setup([['flap', 0.01, 0.28], ['aileron', 0.3, 0.68]], { crow: { enabled: true, aileronUp: 25, flapDown: 45 } })
    const clean = performanceWithXfoil(t.airfoil, t.wing, failed)
    const configs = flightConfigurations(t.sampler, t.controls)
    const run = (id, lookup = failed) => configurationPerformance(t.airfoil, t.wing, clean, configs.find((c) => c.id === id), lookup)
    return { ...t, clean, configs, run }
  }

  it('returns the clean result itself for the clean configuration', () => {
    const { clean, run } = wingWith()
    expect(run('clean').perf).toBe(clean.perf)
  })

  it('lowers the stall speed with flaps down, and starts the stall inboard', () => {
    const { clean, run } = wingWith()
    const flaps = run('flaps')
    expect(flaps.status).toBe('done')
    expect(flaps.surfaces[0].increment.source).toBe('estimate')
    expect(flaps.perf.wingClMax).toBeGreaterThan(clean.perf.wingClMax + 0.05)
    expect(flaps.perf.stallSpeed).toBeLessThan(clean.perf.stallSpeed * 0.98)
    expect(flaps.perf.spanwise.onsetEta).toBeLessThan(0.45)
    // The flapped stations carry more lift than they would clean
    const d = flaps.perf.spanwise.distribution.filter((x) => x.deflected)
    expect(d.length).toBeGreaterThan(2)
  })

  it('keeps the outer wing well short of its stall in crow, so the stall starts inboard', () => {
    const { run } = wingWith()
    const crow = run('crow')
    expect(crow.perf.spanwise.onsetEta).toBeLessThan(0.3)
    const outer = crow.perf.spanwise.distribution.filter((x) => x.eta > 0.6 && x.eta < 0.9)
    for (const x of outer) expect(x.cl).toBeLessThan(x.clMax * 0.8)
  })

  it('asks for the deflected polars once the clean one is in, and uses them when they come', () => {
    const t = setup([['flap', 0.01, 0.28]])
    const alpha = Array.from({ length: 45 }, (_, i) => -4 + i * 0.5)
    const cleanPolar = { re: 150000, step: 0.5, failed: [], alpha, cl: alpha.map((a) => (a <= 12 ? 0.25 + 0.1 * a : 1.45 - 0.08 * (a - 12))) }
    const flapPolar = { re: 150000, step: 0.5, failed: [], alpha, cl: alpha.map((a) => (a <= 8 ? 0.85 + 0.1 * a : 1.65 - 0.08 * (a - 8))) }
    const clean = performanceWithXfoil(t.airfoil, t.wing, () => ({ ok: true, polar: cleanPolar }))
    expect(clean.perf.clMaxSource).toBe('xfoil')
    const config = flightConfigurations(t.sampler, t.controls)[1]
    const waiting = configurationPerformance(t.airfoil, t.wing, clean, config, () => null)
    expect(waiting.status).toBe('computing')
    expect(waiting.need).toEqual([{ flap: { hinge: 0.75, yt: 0.5, deflection: 45 }, re: 150000 }])
    expect(waiting.surfaces[0].increment.source).toBe('estimate')
    const seen = []
    const done = configurationPerformance(t.airfoil, t.wing, clean, config, (flap, re) => {
      seen.push([flap.deflection, re])
      return { ok: true, polar: flapPolar }
    })
    expect(seen).toEqual([[45, 150000]])
    expect(done.status).toBe('done')
    expect(done.need).toEqual([])
    expect(done.surfaces[0].increment).toMatchObject({ source: 'xfoil' })
    expect(done.surfaces[0].increment.dAlphaL0).toBeCloseTo(-6, 6)
    expect(done.surfaces[0].increment.dClMax).toBeCloseTo(0.2, 6)
    // A failed deflected polar falls back to the estimate
    const fell = configurationPerformance(t.airfoil, t.wing, clean, config, failed)
    expect(fell.surfaces[0].increment.source).toBe('estimate')
    expect(fell.status).toBe('done')
  })

  it('leaves a wing without effects exactly as before', () => {
    const t = setup()
    const a = airfoilPerformance(t.airfoil, t.wing)
    const b = airfoilPerformance(t.airfoil, { ...t.wing, wing: { ...t.wing.wing, effects: () => null } })
    expect(b.wingClMax).toBeCloseTo(a.wingClMax, 9)
    expect(b.spanwise.onsetEta).toBe(a.spanwise.onsetEta)
  })
})

describe('progressive stall', () => {
  const rect = () => liftingLine({ span: 1.2, area: 0.24, station: () => ({ c: 0.2, twist: 0, a0: 2 * Math.PI }) })

  it('is the first stall when nothing is progressive', () => {
    const ll = rect()
    const a = firstStall(ll, () => 1.2)
    const b = progressiveStall(ll, () => 1.2, () => false, 0.05)
    expect(b.CLmax).toBeCloseTo(a.CLmax, 9)
    expect(b.eta).toBe(a.eta)
  })

  it('holds a stalled progressive stretch at its Clmax while the rest goes on to stall', () => {
    const ll = rect()
    // The inboard 30% stalls first (lower Clmax) but progressively
    const clMax = (eta) => (eta < 0.3 ? 1.0 : 1.2)
    const first = firstStall(ll, clMax)
    expect(first.eta).toBeLessThan(0.3)
    const st = progressiveStall(ll, clMax, (eta) => eta < 0.3, (10 * Math.PI) / 180)
    expect(st.eta).toBe(first.eta)
    expect(st.CLmax).toBeGreaterThan(first.CLmax + 0.05)
    ll.stations.forEach((s, i) => {
      expect(st.cl[i]).toBeLessThanOrEqual(clMax(s.eta) + 1e-4)
    })
    // An ordinary station has reached its Clmax
    expect(Math.max(...ll.stations.map((s, i) => (s.eta >= 0.3 ? st.cl[i] - 1.2 : -1)))).toBeCloseTo(0, 3)
    // and no further than maxPast beyond the onset
    const short = progressiveStall(ll, clMax, (eta) => eta < 0.3, (0.5 * Math.PI) / 180)
    expect(short.alpha).toBeCloseTo(first.alpha + (0.5 * Math.PI) / 180, 9)
    expect(short.CLmax).toBeLessThan(st.CLmax)
  })

  it('agrees with the twist solution: washout at every station via the influences', () => {
    const ll = liftingLine({ span: 1.2, area: 0.2, station: (eta) => ({ c: 0.2 - 0.1 * eta, twist: 0.05, a0: 2 * Math.PI }) })
    const plain = liftingLine({ span: 1.2, area: 0.2, station: (eta) => ({ c: 0.2 - 0.1 * eta, twist: 0, a0: 2 * Math.PI }) })
    // CLb from 0.05 rad washout = Σ twistCL × 0.05
    expect(plain.twistCL.reduce((t, v) => t + v * 0.05, 0)).toBeCloseTo(ll.CLb, 9)
    plain.stations.forEach((s, i) => {
      const v = plain.influence[i].reduce((t, k) => t + k * 0.05, 0)
      expect(v).toBeCloseTo(ll.stations[i].clb, 9)
    })
  })
})
