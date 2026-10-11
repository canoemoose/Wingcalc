import { describe, it, expect } from 'vitest'
import {
  LIBRARY,
  sectionsIn,
  findSection,
  nearestPolar,
  sectionClMaxAt,
  resolveAirfoil,
  airfoilPerformance,
} from '../src/lib/airfoils.js'
import { stallSpeed, reynolds, WING_CLMAX_FACTOR } from '../src/lib/calc.js'

describe('bundled aerofoil data', () => {
  it('has NACA four-digit and Eppler sections, including the ones the brief names', () => {
    expect(sectionsIn('naca').length).toBeGreaterThanOrEqual(10)
    expect(sectionsIn('eppler').length).toBeGreaterThanOrEqual(10)
    for (const id of ['naca2412-il', 'n0012-il', 'naca4412-il', 'e205-il', 'e374-il']) {
      expect(findSection(id), id).not.toBeNull()
    }
  })

  it('records a source URL and Reynolds number for every polar', () => {
    for (const s of LIBRARY.sections) {
      expect(s.source).toMatch(/^http:\/\/airfoiltools\.com\//)
      expect(s.polars.length, s.id).toBeGreaterThan(0)
      for (const p of s.polars) {
        expect(p.source).toContain(String(p.re))
        expect(p.alpha.length).toBe(p.cl.length)
        expect(p.alpha.length).toBeGreaterThan(10)
      }
    }
  })

  it('has sensible geometry for every section', () => {
    for (const s of LIBRARY.sections) {
      expect(s.thicknessPct, s.id).toBeGreaterThan(5)
      expect(s.thicknessPct, s.id).toBeLessThan(25)
      expect(s.leRadiusPct, s.id).toBeGreaterThan(0.2)
      expect(s.leRadiusPct, s.id).toBeLessThan(5)
      expect(s.coords.length).toBeGreaterThan(30)
    }
  })

  it('measures the NACA 2412 leading-edge radius close to the published 1.58%', () => {
    expect(findSection('naca2412-il').leRadiusPct).toBeGreaterThan(1.4)
    expect(findSection('naca2412-il').leRadiusPct).toBeLessThan(1.75)
  })
})

describe('Reynolds-dependent lookup', () => {
  const s = findSection('naca2412-il')

  it('picks the nearest polar in log terms', () => {
    expect(nearestPolar(s, 140000).re).toBe(100000)
    expect(nearestPolar(s, 150000).re).toBe(200000)
    expect(nearestPolar(s, 5e6).re).toBe(1000000)
  })

  it('interpolates Clmax between polars and clamps at the ends', () => {
    const at100 = sectionClMaxAt(s, 100000)
    const at200 = sectionClMaxAt(s, 200000)
    const mid = sectionClMaxAt(s, Math.sqrt(100000 * 200000))
    expect(mid).toBeCloseTo((at100 + at200) / 2, 6)
    expect(sectionClMaxAt(s, 1e7)).toBe(sectionClMaxAt(s, 1000000))
  })
})

describe('airfoil performance', () => {
  const wing = { mass: 1.4, area: 0.301, chord: 0.217 }

  it('iterates to a self-consistent stall speed and Reynolds number', () => {
    const perf = airfoilPerformance(resolveAirfoil({ source: 'naca', id: 'naca2412-il' }), wing)
    expect(perf.wingClMax).toBeCloseTo(perf.sectionClMax * WING_CLMAX_FACTOR, 12)
    expect(perf.stallSpeed).toBeCloseTo(stallSpeed(wing.mass, wing.area, perf.wingClMax), 6)
    expect(perf.reynolds).toBeCloseTo(reynolds(perf.stallSpeed, wing.chord), -2)
    expect(perf.stallSpeed).toBeGreaterThan(6)
    expect(perf.stallSpeed).toBeLessThan(11)
    expect(['gentle', 'moderate', 'sharp']).toContain(perf.stall.rating)
  })

  it('uses the entered Clmax and the geometry heuristic for a custom section', () => {
    const custom = { clMax: 1.2, thicknessPct: 12, thicknessPosPct: 30, camberPct: 2, camberPosPct: 40, leRadiusPct: 1.59 }
    const perf = airfoilPerformance(resolveAirfoil({ source: 'custom', custom }), wing)
    expect(perf.sectionClMax).toBe(1.2)
    expect(perf.stallSpeed).toBeCloseTo(stallSpeed(wing.mass, wing.area, 1.2 * WING_CLMAX_FACTOR), 12)
    expect(perf.stall.method).toBe('geometry')
    expect(perf.polar).toBeNull()
  })
})
