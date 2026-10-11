import { describe, it, expect } from 'vitest'
import { generateSection, sectionStats, nacaLeRadius, thicknessForm, decimate, zeroLiftAngle, unpack } from '../src/lib/airfoilGeom.js'

const naca = (t, m = 0, p = 0.4) => ({
  thickness: t,
  thicknessPos: 0.3,
  camber: m,
  camberPos: p,
  leRadius: nacaLeRadius(t),
})

describe('section generation', () => {
  it('reproduces NACA 0012 to within drawing accuracy', () => {
    const yt = thicknessForm(naca(0.12))
    // Tabulated NACA 0012 half-thickness (Abbott & von Doenhoff)
    const table = [
      [0.0125, 0.01894],
      [0.05, 0.03555],
      [0.1, 0.04683],
      [0.3, 0.06002],
      [0.6, 0.04563],
      [0.9, 0.01615],
    ]
    // The modified four-digit aft shape differs slightly from the original series (≈0.15% chord).
    for (const [x, y] of table) expect(Math.abs(yt(x) - y), `x=${x}`).toBeLessThan(0.002)
  })

  it('hits the requested thickness, camber and positions', () => {
    for (const p of [naca(0.12, 0.02), naca(0.09, 0.04, 0.3), { ...naca(0.15, 0.03, 0.5), thicknessPos: 0.4 }]) {
      const { coords, valid } = generateSection(p, 120)
      expect(valid).toBe(true)
      const s = sectionStats(coords)
      expect(s.thickness).toBeCloseTo(p.thickness, 3)
      expect(Math.abs(s.thicknessPos - p.thicknessPos)).toBeLessThan(0.02)
      expect(s.camber).toBeCloseTo(p.camber, 3)
      expect(Math.abs(s.camberPos - p.camberPos)).toBeLessThan(0.02)
    }
  })

  it('honours the requested leading-edge radius', () => {
    for (const r of [0.005, 0.0159, 0.03]) {
      const { coords } = generateSection({ ...naca(0.12), leRadius: r }, 200)
      expect(sectionStats(coords).leRadius / r).toBeGreaterThan(0.9)
      expect(sectionStats(coords).leRadius / r).toBeLessThan(1.1)
    }
  })

  it('returns a closed loop in Selig order (upper surface first)', () => {
    const { coords } = generateSection(naca(0.12, 0.02), 40)
    expect(coords[0][0]).toBeCloseTo(1, 3)
    expect(coords.at(-1)[0]).toBeCloseTo(1, 3)
    expect(coords[5][1]).toBeGreaterThan(0)
    expect(coords.at(-6)[1]).toBeLessThan(coords[5][1])
  })
})

describe('section measurement', () => {
  it('uses the NACA leading-edge radius formula', () => {
    expect(nacaLeRadius(0.12)).toBeCloseTo(0.015867, 5)
  })

  it('decimates while keeping the ends and the leading edge', () => {
    const { coords } = generateSection(naca(0.12), 200)
    const d = decimate(coords, 50)
    expect(d.length).toBeLessThanOrEqual(52)
    expect(d[0]).toEqual(coords[0])
    expect(d.at(-1)).toEqual(coords.at(-1))
    expect(d.some(([x]) => x === 0)).toBe(true)
  })
})

describe('zero-lift angle', () => {
  it('matches thin-aerofoil theory for NACA four-digit mean lines', () => {
    // Analytic values: NACA 2412 -2.08°, 4412 -4.15°
    const at = (m) => zeroLiftAngle(generateSection(naca(0.12, m), 120).coords)
    expect(Math.abs(at(0.02) + 2.08)).toBeLessThan(0.1)
    expect(Math.abs(at(0.04) + 4.15)).toBeLessThan(0.1)
    expect(at(0)).toBeCloseTo(0, 6)
  })

  it('unpacks integer-packed coordinates', () => {
    expect(unpack([10000, 0, 5000, 120, 0, 0])).toEqual([
      [1, 0],
      [0.5, 0.012],
      [0, 0],
    ])
  })
})
