import { describe, it, expect } from 'vitest'
import {
  naca4Points,
  sampleSection,
  analyseSection,
  noseRadiusOf,
  fairShape,
  applyRadius,
  leIndex,
  closeTrailingEdge,
  syncTrailingEdge,
  sectionCoords,
  drawnFromParams,
  selfIntersects,
} from '../src/lib/sectionSpline.js'

const SEED_CODES = ['2412', '0012', '4415']
const copy = (pts) => JSON.parse(JSON.stringify(pts))

describe('NACA seeds', () => {
  it('gives the expected thickness and camber for 2412', () => {
    const a = analyseSection(naca4Points('2412'))
    expect(a.tmax).toBeCloseTo(0.12, 2)
    expect(a.xt).toBeGreaterThan(0.25)
    expect(a.xt).toBeLessThan(0.35)
    expect(a.cmax).toBeCloseTo(0.02, 2)
    expect(a.xc).toBeGreaterThan(0.35)
    expect(a.xc).toBeLessThan(0.45)
  })

  it('gives a symmetric 0012 with no camber', () => {
    const a = analyseSection(naca4Points('0012'))
    expect(a.tmax).toBeCloseTo(0.12, 2)
    expect(Math.abs(a.cmax)).toBeLessThan(1e-3)
  })

  it('gives a 15 % section for 4415', () => {
    const a = analyseSection(naca4Points('4415'))
    expect(a.tmax).toBeCloseTo(0.15, 2)
    expect(a.cmax).toBeCloseTo(0.04, 2)
  })
})

describe('sampling', () => {
  it('passes through every input point, including the LE', () => {
    for (const code of SEED_CODES) {
      const pts = naca4Points(code)
      const D = sampleSection(pts)
      pts.forEach((p, i) => {
        const q = D[D.at[i]]
        expect(Math.abs(q.x - p.x), `${code} point ${i} x`).toBeLessThan(1e-9)
        expect(Math.abs(q.y - p.y), `${code} point ${i} y`).toBeLessThan(1e-9)
      })
      const le = pts[leIndex(pts)]
      const dl = D[D.at[leIndex(pts)]]
      expect(Math.hypot(dl.x - le.x, dl.y - le.y)).toBeLessThan(1e-9)
    }
  })
})

describe('nose radius', () => {
  it('measures within 2 % of the set radius for 0.5 % to 5 %', () => {
    for (const code of SEED_CODES) {
      for (const r of [0.005, 0.01, 0.02, 0.035, 0.05]) {
        const shaped = applyRadius(naca4Points(code), r)
        const measured = noseRadiusOf(shaped)
        expect(Math.abs(measured - r) / r, `${code} r=${r} measured ${measured}`).toBeLessThan(0.02)
      }
    }
  })

  it('is reversible: returning to the base radius from the same base restores the base', () => {
    const base = naca4Points('2412')
    const l = leIndex(base)
    const r1 = base[l].r
    const changed = applyRadius(base, 0.03)
    expect(changed[l].r).toBe(0.03)
    const back = applyRadius(base, r1)
    back.forEach((p, i) => {
      expect(Math.abs(p.x - base[i].x), `point ${i} x`).toBeLessThan(1e-9)
      expect(Math.abs(p.y - base[i].y), `point ${i} y`).toBeLessThan(1e-9)
    })
  })

  it('leaves the trailing-edge points untouched', () => {
    const base = naca4Points('4415')
    const out = applyRadius(base, 0.04)
    expect(out[0]).toEqual(base[0])
    expect(out[out.length - 1]).toEqual(base[base.length - 1])
  })
})

describe('fairing', () => {
  it('20 passes add no curvature sign changes on either surface', () => {
    const base = naca4Points('2412')
    const start = analyseSection(base)
    let pts = base
    for (let pass = 0; pass < 20; pass++) {
      pts = fairShape(pts, pts.map((_, i) => i), { keepThickness: true })
      const a = analyseSection(pts)
      expect(a.inflU, `pass ${pass} upper`).toBeLessThanOrEqual(start.inflU)
      expect(a.inflL, `pass ${pass} lower`).toBeLessThanOrEqual(start.inflL)
    }
  })

  it('with keepThickness, the max thickness stays within 0.1 % chord', () => {
    const base = naca4Points('2412')
    const t0 = analyseSection(base).tmax
    let pts = base
    for (let pass = 0; pass < 20; pass++) {
      pts = fairShape(pts, pts.map((_, i) => i), { keepThickness: true })
      expect(Math.abs(analyseSection(pts).tmax - t0), `pass ${pass}`).toBeLessThan(0.001)
    }
  })
})

describe('inputs', () => {
  it('are not mutated by any function', () => {
    const pts = naca4Points('2412')
    pts[3] = { ...pts[3], straight: true }
    const snapshot = copy(pts)
    sampleSection(pts)
    analyseSection(pts)
    noseRadiusOf(pts)
    fairShape(pts, pts.map((_, i) => i))
    applyRadius(pts, 0.03)
    expect(pts).toEqual(snapshot)
  })
})

describe('editing helpers', () => {
  it('moves a point in chord fractions and keeps the surface in order', async () => {
    const { setPointAt, normalise } = await import('../src/lib/sectionSpline.js')
    const P = naca4Points('2412')
    // Point 2 is on the upper surface near 60 % chord; asking for 30 % would cross point 3, so it stops short of it
    const S = setPointAt(P, 2, 0.3, 0.05)
    const before = normalise(P).pts[3].x
    expect(normalise(S).pts[2].x).toBeCloseTo(before + 0.0005, 3)
    expect(normalise(S).pts[2].y).toBeCloseTo(0.05, 6)
    // A point well clear of its neighbours moves exactly where it is sent
    const T = setPointAt(P, 2, 0.55, 0.07)
    expect(normalise(T).pts[2].x).toBeCloseTo(0.55, 6)
    expect(normalise(T).pts[2].y).toBeCloseTo(0.07, 6)
    // The LE is locked
    expect(setPointAt(P, leIndex(P), 0.1, 0.1)).toBe(P)
  })

  it('straightens a segment, but not one at the nose', async () => {
    const { setStraight } = await import('../src/lib/sectionSpline.js')
    const P = naca4Points('2412')
    const l = leIndex(P)
    expect(setStraight(P, 2, true)[2].straight).toBe(true)
    expect(setStraight(setStraight(P, 2, true), 2, false)[2].straight).toBeUndefined()
    expect(setStraight(P, l - 1, true)).toBe(P)
    expect(setStraight(P, l, true)).toBe(P)
  })

  it('mirrors one surface onto the other about the chord', async () => {
    const { mirrorSurface, analyseSection, normalise, leIndex: li } = await import('../src/lib/sectionSpline.js')
    const P = naca4Points('2412')
    const N = normalise(P).pts
    const l = li(P)
    const M = mirrorSurface(P, 0)
    const NM = normalise(M).pts
    const lm = li(M)
    expect(M.length).toBe(P.length)
    // The lower surface is the upper one turned over: the same x, the opposite y, in reverse order
    for (let j = 0; j < l - 1; j++) {
      expect(NM[lm + 1 + j].x).toBeCloseTo(N[l - 1 - j].x, 3)
      expect(NM[lm + 1 + j].y).toBeCloseTo(-N[l - 1 - j].y, 3)
    }
    // Mirroring about the chord leaves no camber, from either surface
    expect(Math.abs(analyseSection(M).cmax)).toBeLessThan(1e-6)
    expect(Math.abs(analyseSection(mirrorSurface(P, P.length - 1)).cmax)).toBeLessThan(1e-6)
    expect(mirrorSurface(P, l)).toBe(P)
  })
})

describe('sharp trailing edge', () => {
  const ends = (P) => [P[0], P[P.length - 1]]
  it('closes every seed and the drawn copy of a parametric section', () => {
    for (const code of SEED_CODES) {
      const [a, b] = ends(naca4Points(code))
      expect(a.x).toBe(b.x)
      expect(a.y).toBe(b.y)
    }
    const [a, b] = ends(drawnFromParams({ thicknessPct: 12, thicknessPosPct: 30, camberPct: 2, camberPosPct: 40, leRadiusPct: 1.59 }))
    expect(a.y).toBe(b.y)
  })

  it('closes an open section at the midpoint of its two trailing-edge points', () => {
    const P = copy(naca4Points('0012'))
    P[0] = { x: 1, y: 0.01 }
    P[P.length - 1] = { x: 0.98, y: -0.01 }
    const [a, b] = ends(closeTrailingEdge(P))
    expect(a).toEqual({ x: 0.99, y: 0 })
    expect(b).toEqual({ x: 0.99, y: 0 })
  })

  it('carries the other trailing-edge point with whichever one moved', () => {
    const base = naca4Points('2412'), n = base.length
    const up = copy(base)
    up[0] = { ...up[0], x: 1.05, y: 0.02 }
    expect(ends(syncTrailingEdge(base, up))[1]).toMatchObject({ x: 1.05, y: 0.02 })
    const lo = copy(base)
    lo[n - 1] = { ...lo[n - 1], x: 0.95, y: -0.02 }
    expect(ends(syncTrailingEdge(base, lo))[0]).toMatchObject({ x: 0.95, y: -0.02 })
    const both = copy(base)
    both[0] = { ...both[0], x: 1, y: 0.02 }
    both[n - 1] = { ...both[n - 1], x: 1, y: -0.01 }
    expect(ends(syncTrailingEdge(base, both))[0]).toMatchObject({ x: 1, y: 0.005 })
    expect(syncTrailingEdge(base, base)).toBe(base)
  })

  it('analyses a section saved with an open trailing edge as sharp', () => {
    const P = copy(naca4Points('2412'))
    P[0] = { ...P[0], y: P[0].y + 0.005 }
    const c = sectionCoords(P)
    expect(c[0][1]).toBeCloseTo(c[c.length - 1][1], 9)
  })
})

describe('selfIntersects', () => {
  it('passes every seed section', () => {
    for (const code of SEED_CODES) expect(selfIntersects(naca4Points(code))).toBe(false)
  })
  it('catches an upper point dragged through the lower surface', () => {
    const pts = copy(naca4Points('2412'))
    const l = leIndex(pts)
    const i = Math.floor(l / 2) // an upper point mid-chord
    pts[i].y = -0.2
    expect(selfIntersects(pts)).toBe(true)
  })
})
