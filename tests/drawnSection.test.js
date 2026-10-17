import { describe, it, expect } from 'vitest'
import { defaultState, migrate } from '../src/lib/projects.js'
import { resolveAirfoil } from '../src/lib/airfoils.js'
import { drawnFromParams, sectionCoords, naca4Points, isDrawnSection } from '../src/lib/sectionSpline.js'

const base = () => defaultState().airfoil.custom
const parametric = (c) => resolveAirfoil({ source: 'custom', custom: c })
const drawn = (c, seed = null) => resolveAirfoil({ source: 'custom', custom: { ...c, drawn: { pts: drawnFromParams(c), seed } } })

describe('migrate: drawn section', () => {
  it('gives older saves drawn: null', () => {
    const old = { airfoil: { source: 'custom', custom: { thicknessPct: 12, thicknessPosPct: 30, camberPct: 2, camberPosPct: 40, leRadiusPct: 1.59 } } }
    const m = migrate(old)
    expect(m.airfoil.custom.drawn).toBeNull()
    expect(m.airfoil.custom.thicknessPct).toBe(12)
  })

  it('drops a drawn section with too few points or without exactly one LE point', () => {
    const pts = drawnFromParams(base())
    const short = { pts: pts.slice(0, 4), seed: 'naca2412' }
    const noLe = { pts: pts.map((p) => ({ x: p.x, y: p.y })), seed: null }
    const twoLe = { pts: pts.map((p, i) => (i === 3 || i === 9 ? { ...p, le: true } : p)), seed: null }
    for (const drawnBad of [short, noLe, twoLe, 'nope', { seed: null }]) {
      const m = migrate({ airfoil: { source: 'custom', custom: { drawn: drawnBad } } })
      expect(m.airfoil.custom.drawn).toBeNull()
    }
  })

  it('keeps a good drawn section with its seed', () => {
    const pts = drawnFromParams(base())
    const m = migrate({ airfoil: { source: 'custom', custom: { drawn: { pts, seed: 'naca2412' } } } })
    expect(m.airfoil.custom.drawn.pts).toEqual(pts)
    expect(m.airfoil.custom.drawn.seed).toBe('naca2412')
    expect(isDrawnSection(m.airfoil.custom.drawn)).toBe(true)
  })

  it('treats a non-string seed as null', () => {
    const m = migrate({ airfoil: { source: 'custom', custom: { drawn: { pts: drawnFromParams(base()), seed: 7 } } } })
    expect(m.airfoil.custom.drawn.seed).toBeNull()
  })
})

describe('resolveAirfoil: drawn section', () => {
  const c2412 = { thicknessPct: 12, thicknessPosPct: 30, camberPct: 2, camberPosPct: 40, leRadiusPct: 1.59 }

  it('returns coords in the same format as the parametric branch', () => {
    const p = parametric(c2412), d = drawn(c2412)
    expect(d.kind).toBe('custom')
    expect(d.name).toBe('Drawn section')
    expect(d.drawn).toBe(true)
    expect(p.drawn).toBeUndefined()
    expect(d.coords.length).toBe(p.coords.length)
    // Selig order: starts at the upper TE, runs over the LE, and ends at the lower TE
    expect(d.coords[0][0]).toBeCloseTo(1, 2)
    expect(d.coords[d.coords.length - 1][0]).toBeCloseTo(1, 2)
    const iLe = d.coords.reduce((best, pt, i) => (pt[0] < d.coords[best][0] ? i : best), 0)
    expect(d.coords[iLe][0]).toBeCloseTo(0, 3)
    expect(d.coords[iLe][1]).toBeCloseTo(0, 2)
    expect(d.coords[1][1]).toBeGreaterThan(0)
    expect(d.coords[d.coords.length - 2][1]).toBeLessThan(0)
    expect(d.coords[0][1]).toBeGreaterThan(0)
    // Length of the closed outline: about 2 chords for a 12 % section
    const len = d.coords.slice(1).reduce((s, pt, i) => s + Math.hypot(pt[0] - d.coords[i][0], pt[1] - d.coords[i][1]), 0)
    expect(len).toBeGreaterThan(2.0)
    expect(len).toBeLessThan(2.2)
    expect(d.valid).toBe(true)
  })

  it('measures params within 0.3 % chord of the parametric 2412', () => {
    const d = drawn(c2412).params
    expect(Math.abs(d.thickness - 0.12)).toBeLessThan(0.003)
    expect(Math.abs(d.thicknessPos - 0.3)).toBeLessThan(0.003)
    expect(Math.abs(d.camber - 0.02)).toBeLessThan(0.003)
    // The camber peak of a 2 % camber line is flat, so its position is measured to about 2 % chord at best
    expect(Math.abs(d.camberPos - 0.4)).toBeLessThan(0.025)
    expect(Math.abs(d.leRadius - 0.0159)).toBeLessThan(0.003)
  })

  it('marks a degenerate drawn section invalid', () => {
    // Surfaces that meet at the TE and LE: no thickness at all
    const pts = [
      { x: 1, y: 0 }, { x: 0.5, y: 0 }, { x: 0.2, y: 0 }, { x: 0.05, y: 0 },
      { x: 0, y: 0, le: true, r: 0.01 },
      { x: 0.05, y: 0 }, { x: 0.2, y: 0 }, { x: 0.5, y: 0 }, { x: 1, y: 0 },
    ]
    const r = resolveAirfoil({ source: 'custom', custom: { ...c2412, drawn: { pts, seed: null } } })
    expect(r.valid).toBe(false)
  })

  it('falls back to the parametric branch when drawn is not usable', () => {
    const r = resolveAirfoil({ source: 'custom', custom: { ...c2412, drawn: { pts: [], seed: null } } })
    expect(r.name).toBe('Custom section')
    expect(r.drawn).toBeUndefined()
  })
})

describe('drawnFromParams', () => {
  it('lays out 19 points: 9 upper TE -> LE, the LE, 9 lower LE -> TE', () => {
    const pts = drawnFromParams(base())
    expect(pts.length).toBe(19)
    expect(pts[9].le).toBe(true)
    expect(pts[9].r).toBeCloseTo(0.0159, 4)
    expect(pts[0].x).toBe(1)
    expect(pts[18].x).toBe(1)
    // The trailing edge is sharp: both surfaces end on the same point
    expect(pts[0].y).toBe(pts[18].y)
  })

  it('round-trips: resolving the drawn copy gives back the parametric params', () => {
    const cases = [
      { thicknessPct: 12, thicknessPosPct: 30, camberPct: 2, camberPosPct: 40, leRadiusPct: 1.59 },
      { thicknessPct: 9, thicknessPosPct: 40, camberPct: 0, camberPosPct: 50, leRadiusPct: 0.8 },
      { thicknessPct: 15, thicknessPosPct: 25, camberPct: 4, camberPosPct: 35, leRadiusPct: 2.5 },
    ]
    for (const c of cases) {
      const p = parametric(c).params, d = drawn(c).params
      expect(Math.abs(d.thickness - p.thickness)).toBeLessThan(0.003)
      // The thickness peak is flat too, so its position is looser (about 1 % chord)
      expect(Math.abs(d.thicknessPos - p.thicknessPos)).toBeLessThan(0.01)
      expect(Math.abs(d.camber - p.camber)).toBeLessThan(0.003)
      // A flat camber peak: its position is only meaningful for a cambered section
      if (p.camber > 0.005) expect(Math.abs(d.camberPos - p.camberPos)).toBeLessThan(0.025)
      expect(Math.abs(d.leRadius - p.leRadius)).toBeLessThan(0.003)
    }
  })

  it('sectionCoords of a NACA seed matches generateSection in point count and ends', () => {
    const coords = sectionCoords(naca4Points('2412'))
    expect(coords.length).toBe(121)
    expect(coords[0][0]).toBeCloseTo(1, 2)
  })
})
