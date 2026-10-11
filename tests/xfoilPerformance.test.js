import { describe, it, expect } from 'vitest'
import { resolveAirfoil, airfoilPerformance, performanceWithXfoil, usableComputedPolar } from '../src/lib/airfoils.js'
import { quantiseRe } from '../src/lib/xfoil.js'

const wing = { mass: 1.4, area: 0.3, chord: 0.22 }
const custom = { thicknessPct: 12, thicknessPosPct: 30, camberPct: 2, camberPosPct: 40, leRadiusPct: 1.59 }

// A synthetic computed polar: linear lift to a peak of clMax at 12°, falling after.
function fakePolar(re, clMax = 1.3, { gapsAt = [] } = {}) {
  const alpha = []
  for (let a = -4; a <= 18; a += 0.5) if (!gapsAt.includes(a)) alpha.push(a)
  const cl = alpha.map((a) => (a <= 12 ? 0.2 + ((clMax - 0.2) * (a + 2)) / 14 : clMax - 0.06 * (a - 12)))
  return { re, alpha, cl, cd: cl.map(() => 0.01), cm: cl.map(() => -0.05), failed: gapsAt, step: 0.5 }
}

describe('performance from computed polars', () => {
  it('asks for a polar at the grid Re nearest the estimated stall Re first', () => {
    const a = resolveAirfoil({ source: 'custom', custom })
    const instant = airfoilPerformance(a, wing)
    const r = performanceWithXfoil(a, wing, () => null)
    expect(r.status).toBe('computing')
    expect(r.need).toBe(quantiseRe(instant.reynolds))
    expect(r.perf).toEqual(instant)
  })

  it('follows the stall Re to a settled grid point and uses the computed Clmax', () => {
    const a = resolveAirfoil({ source: 'custom', custom })
    const solved = new Map()
    let r = performanceWithXfoil(a, wing, (re) => solved.get(re) ?? null)
    for (let i = 0; i < 6 && r.need; i++) {
      solved.set(r.need, { ok: true, polar: fakePolar(r.need, 1.6) })
      r = performanceWithXfoil(a, wing, (re) => solved.get(re) ?? null)
    }
    expect(r.status).toBe('done')
    expect(r.need).toBeNull()
    expect(r.perf.clMaxSource).toBe('xfoil')
    expect(r.perf.sectionClMax).toBeCloseTo(1.6, 9)
    expect(Math.abs(r.perf.reynolds / r.perf.polar.re - 1)).toBeLessThan(0.1)
    expect(r.perf.curve.computed).toBe(true)
    expect(r.perf.stall.method).toBe('polar')
  })

  it('keeps the instant answer and reports failure when the polar is unusable', () => {
    const a = resolveAirfoil({ source: 'custom', custom })
    const r = performanceWithXfoil(a, wing, () => ({ ok: false, error: 'timed out' }))
    expect(r.status).toBe('failed')
    expect(r.perf.clMaxSource).toBe('estimated')
    const empty = { ok: true, polar: { re: 1e5, alpha: [0, 0.5], cl: [0.2, 0.25], step: 0.5 } }
    expect(performanceWithXfoil(a, wing, () => empty).status).toBe('failed')
  })

  it('takes failures straight after the peak as stall, but not a sweep that ended there', () => {
    const p = fakePolar(1e5)
    const cut = p.alpha.findIndex((x) => x > 12)
    expect(usableComputedPolar(p)).toBe(true)
    const stalled = { ...p, alpha: p.alpha.slice(0, cut), cl: p.cl.slice(0, cut), failed: p.alpha.slice(cut) }
    expect(usableComputedPolar(stalled)).toBe(true)
    expect(usableComputedPolar({ ...stalled, failed: [] })).toBe(false)
  })

  it('leaves gaps in the curve where points did not converge', () => {
    const a = resolveAirfoil({ source: 'custom', custom })
    const perf = airfoilPerformance(a, wing, { polar: fakePolar(2e5, 1.3, { gapsAt: [3, 3.5] }) })
    expect(perf.curve.segments).toHaveLength(2)
  })

  it('flags a library section whose computed Clmax differs from airfoiltools.com', () => {
    const a = resolveAirfoil({ source: 'naca', id: 'naca2412-il' })
    const close = airfoilPerformance(a, wing, { polar: fakePolar(2e5, 1.33) })
    expect(close.reference.clMax).toBeGreaterThan(1.2)
    const far = airfoilPerformance(a, wing, { polar: fakePolar(2e5, close.reference.clMax + 0.1) })
    expect(far.reference.differs).toBe(true)
    expect(far.curve.reference.re).toBe(200000)
    expect(far.curve.reference.cl.length).toBe(far.curve.reference.alpha.length)
    const near = airfoilPerformance(a, wing, { polar: fakePolar(2e5, close.reference.clMax + 0.01) })
    expect(near.reference.differs).toBe(false)
    expect(near.curve.reference).toBeUndefined()
    const custom1 = airfoilPerformance(resolveAirfoil({ source: 'custom', custom }), wing, { polar: fakePolar(2e5) })
    expect(custom1.reference).toBeUndefined()
  })
})
