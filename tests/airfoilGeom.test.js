import { describe, it, expect } from 'vitest'
import {
  generateSection,
  sectionStats,
  nacaLeRadius,
  thicknessForm,
  decimate,
  zeroLiftAngle,
  unpack,
  elementCount,
  isMultiElement,
} from '../src/lib/airfoilGeom.js'

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

describe('multi-element detection', () => {
  const section = (t = 0.12, m = 0.02) => generateSection(naca(t, m)).coords
  // An element of chord c, with its nose at (x0, y0) and its chord tilted down by `droop` radians
  const place = (coords, c, x0, y0 = 0, droop = 0) =>
    coords.map(([x, y]) => [
      x0 + c * (x * Math.cos(droop) + y * Math.sin(droop)),
      y0 + c * (-x * Math.sin(droop) + y * Math.cos(droop)),
    ])

  it('counts one element for single sections, thin to thick', () => {
    for (const [t, m] of [[0.06, 0], [0.12, 0.02], [0.18, 0.04], [0.25, 0.06]]) {
      expect(elementCount(section(t, m)), `${t} ${m}`).toBe(1)
    }
  })

  it('counts one element for a section in Lednicer order (both surfaces from the nose)', () => {
    const c = section()
    const iLe = c.findIndex(([x]) => x === 0)
    const lednicer = [...c.slice(0, iLe + 1).reverse(), ...c.slice(iLe)]
    expect(elementCount(lednicer)).toBe(1)
  })

  it('is not fooled by sparse files that join long straight stretches with one step', () => {
    // Like CAP 21C in the UIUC catalogue: no points between 25% and 97% chord
    const sparse = section().filter(([x]) => x < 0.25 || x > 0.97)
    expect(elementCount(sparse)).toBe(1)
  })

  it('ignores ragged points at the nose and trailing edge', () => {
    const c = section().map(([x, y], i) => [x + (x < 0.02 || x > 0.98 ? (i % 2 ? 0.004 : -0.004) : 0), y])
    expect(elementCount(c)).toBe(1)
  })

  it('counts each element of a slat, main element and flap set', () => {
    const main = place(section(0.12, 0.02), 0.85, 0)
    const flap = place(section(0.1, 0.03), 0.28, 0.86, -0.01, 0.4)
    const slat = place(section(0.1, 0.05), 0.16, -0.12, -0.04, -0.5)
    expect(elementCount([...main, ...flap])).toBe(2)
    expect(elementCount([...slat, ...main, ...flap])).toBe(3)
    expect(isMultiElement([...main, ...flap])).toBe(true)
    expect(isMultiElement(main)).toBe(false)
  })

  it('still finds the elements once the set is decimated for drawing', () => {
    const set = [
      ...place(section(0.1, 0.05), 0.16, -0.12, -0.04, -0.5),
      ...place(section(0.12, 0.02), 0.85, 0),
      ...place(section(0.1, 0.03), 0.28, 0.86, -0.01, 0.4),
    ]
    expect(elementCount(decimate(set, 60))).toBe(3)
  })
})
