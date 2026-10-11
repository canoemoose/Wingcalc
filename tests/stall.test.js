import { describe, it, expect } from 'vitest'
import { analysePolar, ratePolar, rateGeometry, POLAR_THRESHOLDS } from '../src/lib/stall.js'

// Synthetic polar: linear lift curve (0.1 per degree from zero lift at -2°) up to a peak,
// optionally rounded over before it, then falling at a set fraction of Clmax per degree.
function polar({ peakAlpha = 12, rounding = 0.3, dropPerDeg = 0.01, endAlpha = 18 }) {
  const alpha = []
  const cl = []
  const linear = (a) => 0.1 * (a + 2)
  const roundStart = peakAlpha - 3
  // Lift gained over the last 3° before the peak is `rounding` × what the linear slope gives.
  const clAtRoundStart = linear(roundStart)
  const peak = clAtRoundStart + rounding * 0.3
  for (let a = -4; a <= endAlpha + 1e-9; a += 0.25) {
    let c
    if (a <= roundStart) c = linear(a)
    else if (a <= peakAlpha) {
      const t = (a - roundStart) / 3
      // Quadratic easing so the slope falls to zero at the peak
      c = clAtRoundStart + (peak - clAtRoundStart) * (2 * t - t * t)
    } else c = peak * (1 - dropPerDeg * (a - peakAlpha))
    alpha.push(Number(a.toFixed(2)))
    cl.push(c)
  }
  return { alpha, cl }
}

describe('polar analysis', () => {
  it('finds Clmax, its angle and the lift-curve slope', () => {
    const m = analysePolar(polar({ peakAlpha: 12, rounding: 0.3 }))
    expect(m.alphaClMax).toBeCloseTo(12, 5)
    expect(m.clMax).toBeCloseTo(0.1 * 11 + 0.09, 5)
    expect(m.liftSlopePerDeg).toBeCloseTo(0.1, 5)
  })

  it('measures post-stall drop per degree', () => {
    expect(analysePolar(polar({ dropPerDeg: 0.05 })).dropPerDeg).toBeCloseTo(0.05, 4)
  })

  it('measures pre-stall rounding as a fraction of linear lift gain', () => {
    expect(analysePolar(polar({ rounding: 0.4 })).rounding).toBeCloseTo(0.4, 4)
  })

  it('reports no drop rate when the data stops at the peak', () => {
    const m = analysePolar(polar({ endAlpha: 12 }))
    expect(m.dropPerDeg).toBeNull()
    expect(m.postStallSpan).toBe(0)
  })
})

describe('polar stall rating', () => {
  const t = POLAR_THRESHOLDS
  const rate = (o) => ratePolar(polar({ rounding: 0.3, ...o })).rating

  it('rates by post-stall lift drop', () => {
    expect(rate({ dropPerDeg: 0.01 })).toBe('gentle')
    expect(rate({ dropPerDeg: 0.05 })).toBe('moderate')
    expect(rate({ dropPerDeg: 0.15 })).toBe('sharp')
  })

  it('moves one step sharper when lift climbs linearly into the stall', () => {
    expect(rate({ dropPerDeg: 0.01, rounding: t.roundingSharper + 0.1 })).toBe('moderate')
    expect(rate({ dropPerDeg: 0.05, rounding: t.roundingSharper + 0.1 })).toBe('sharp')
  })

  it('moves one step gentler when the curve flattens well before the peak', () => {
    expect(rate({ dropPerDeg: 0.05, rounding: t.roundingGentler - 0.05 })).toBe('gentle')
    expect(rate({ dropPerDeg: 0.15, rounding: t.roundingGentler - 0.05 })).toBe('moderate')
  })

  it('falls back to a low-confidence rating when there is no post-stall data', () => {
    const r = ratePolar(polar({ endAlpha: 12, rounding: 0.3 }))
    expect(r.rating).toBe('moderate')
    expect(r.confidence).toBe('low')
    expect(ratePolar(polar({ endAlpha: 12, rounding: 0.8 })).rating).toBe('sharp')
  })

  it('always gives an explanation', () => {
    expect(ratePolar(polar({ dropPerDeg: 0.05 })).explanation).toMatch(/per degree/)
  })
})

describe('geometry stall heuristic', () => {
  const base = { camber: 0.02, camberPos: 0.4, re: 200000 }

  it('rates by nose ordinate at 1.25% chord', () => {
    expect(rateGeometry({ ...base, upper125: 0.013 }).rating).toBe('sharp') // NACA 0009-like
    expect(rateGeometry({ ...base, upper125: 0.019 }).rating).toBe('moderate') // NACA 0012-like
    expect(rateGeometry({ ...base, upper125: 0.0244 }).rating).toBe('gentle') // NACA 4412-like
  })

  it('makes forward-cambered sections sharper', () => {
    expect(rateGeometry({ ...base, upper125: 0.026, camberPos: 0.15 }).rating).toBe('moderate') // 23012-like
  })

  it('adjusts for Reynolds number', () => {
    expect(rateGeometry({ ...base, upper125: 0.019, re: 60000 }).rating).toBe('sharp')
    expect(rateGeometry({ ...base, upper125: 0.019, re: 600000 }).rating).toBe('gentle')
    expect(rateGeometry({ ...base, upper125: 0.019, re: null }).rating).toBe('moderate')
  })

  it('is marked low confidence and explains itself', () => {
    const r = rateGeometry({ ...base, upper125: 0.019 })
    expect(r.confidence).toBe('low')
    expect(r.explanation).toMatch(/1\.25% chord/)
  })
})
