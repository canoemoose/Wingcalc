import { describe, it, expect } from 'vitest'
import {
  naca4Points,
  sampleSection,
  analyseSection,
  bendSegment,
  moveStraightSegment,
  clampOrder,
  leIndex,
} from '../src/lib/sectionSpline.js'

const withStraight = (pts, ui) => pts.map((p, i) => (i === ui ? { ...p, straight: true } : { ...p }))

// Angle in degrees between the line of straight segment ui and the sampled curve on the outside of its end `end`
// (0 = start point, 1 = end point), taken on the secant from the nearest sample on that side to the joint.
function jointAngle(pts, ui, end) {
  const D = sampleSection(pts), r = D.range[ui]
  const a = pts[ui], b = pts[ui + 1]
  const line = Math.atan2(b.y - a.y, b.x - a.x)
  const j = end === 0 ? r[0] : r[1]
  const o = end === 0 ? r[0] - 1 : r[1] + 1
  const sec = Math.atan2(D[j].y - D[o].y, D[j].x - D[o].x)
  let d = Math.abs(sec - line) % Math.PI
  d = Math.min(d, Math.PI - d)
  return (d * 180) / Math.PI
}

const surfaceXs = (pts) => {
  const l = leIndex(pts)
  return { upper: pts.slice(0, l + 1).map((p) => p.x), lower: pts.slice(l).map((p) => p.x) }
}

describe('straight segments are tangent to their neighbours', () => {
  it('meets the curve at both ends on 2412 (within 0.5 degrees)', () => {
    const pts = withStraight(naca4Points('2412'), 3)
    expect(jointAngle(pts, 3, 0)).toBeLessThan(0.5)
    expect(jointAngle(pts, 3, 1)).toBeLessThan(0.5)
  })

  it('stays tangent after a diagonal move', () => {
    const pts = withStraight(naca4Points('2412'), 3)
    const moved = moveStraightSegment(pts, 3, { x: 0.01, y: -0.008 })
    expect(jointAngle(moved, 3, 0)).toBeLessThan(0.5)
    expect(jointAngle(moved, 3, 1)).toBeLessThan(0.5)
  })
})

describe('moveStraightSegment', () => {
  const pts = withStraight(naca4Points('2412'), 3)
  const dxy = { x: 0.012, y: 0.006 }

  it('moves both ends by exactly dxy when unconstrained', () => {
    const out = moveStraightSegment(pts, 3, dxy)
    expect(out[3].x - pts[3].x).toBeCloseTo(dxy.x, 12)
    expect(out[3].y - pts[3].y).toBeCloseTo(dxy.y, 12)
    expect(out[4].x - pts[4].x).toBeCloseTo(dxy.x, 12)
    expect(out[4].y - pts[4].y).toBeCloseTo(dxy.y, 12)
  })

  it("'along' keeps only the component along the line", () => {
    const a = pts[3], b = pts[4]
    const el = Math.hypot(b.x - a.x, b.y - a.y)
    const e = { x: (b.x - a.x) / el, y: (b.y - a.y) / el }
    const s = dxy.x * e.x + dxy.y * e.y
    const out = moveStraightSegment(pts, 3, dxy, 'along')
    expect(out[3].x - a.x).toBeCloseTo(s * e.x, 9)
    expect(out[3].y - a.y).toBeCloseTo(s * e.y, 9)
    expect(out[4].x - b.x).toBeCloseTo(s * e.x, 9)
    expect(out[4].y - b.y).toBeCloseTo(s * e.y, 9)
  })

  it("'across' keeps only the component across the line", () => {
    const a = pts[3], b = pts[4]
    const el = Math.hypot(b.x - a.x, b.y - a.y)
    const n = { x: -(b.y - a.y) / el, y: (b.x - a.x) / el }
    const s = dxy.x * n.x + dxy.y * n.y
    const out = moveStraightSegment(pts, 3, dxy, 'across')
    expect(out[3].x - a.x).toBeCloseTo(s * n.x, 9)
    expect(out[3].y - a.y).toBeCloseTo(s * n.y, 9)
    expect(out[4].x - b.x).toBeCloseTo(s * n.x, 9)
    expect(out[4].y - b.y).toBeCloseTo(s * n.y, 9)
  })
})

describe('bendSegment', () => {
  // The grabbed spot is the sample nearest u; after the refinement it should sit within 1e-3 chord of its target.
  const TOL = 1e-3

  it('moves the sampled curve at the grabbed u by dxy (within 1e-3 chord)', () => {
    const base = naca4Points('2412')
    const i = 2, u = 0.5, dxy = { x: 0.01, y: -0.012 }
    const out = bendSegment(base, i, u, dxy)
    const k = Math.round(u * 24)
    const D0 = sampleSection(base), D1 = sampleSection(out)
    const idx = D0.range[i][0] + k
    expect(Math.abs(D1[idx].x - D0[idx].x - dxy.x), 'x').toBeLessThan(TOL)
    expect(Math.abs(D1[idx].y - D0[idx].y - dxy.y), 'y').toBeLessThan(TOL)
  })

  it('never moves the leading edge, including for segments touching the nose', () => {
    const base = naca4Points('2412')
    const l = leIndex(base)
    for (const i of [l - 2, l - 1, l, l + 1]) {
      const out = bendSegment(base, i, 0.4, { x: 0.005, y: 0.01 })
      expect(out[l], `segment ${i}`).toEqual(base[l])
    }
  })
})

describe('inflections', () => {
  it('reports none near the nose on the plain seeds', () => {
    for (const code of ['2412', '0012', '4415']) {
      const a = analyseSection(naca4Points(code))
      expect(a.infls.filter((e) => e.x < 0.1), code).toEqual([])
    }
  })

  it('reports an inflection near a point pushed well inwards', () => {
    const base = naca4Points('2412')
    const pushed = base.map((p, i) => (i === 4 ? { ...p, y: p.y - 0.04 } : p))
    const a = analyseSection(pushed)
    const upper = a.infls.filter((e) => e.surf === 'Upper')
    expect(upper.length).toBeGreaterThanOrEqual(1)
    expect(upper.some((e) => Math.abs(e.x - base[4].x) < 0.1)).toBe(true)
  })
})

describe('point order', () => {
  it('clampOrder pulls a point back in front of its outer neighbour', () => {
    const base = naca4Points('2412')
    // Point 4 (upper, x about 0.3) pushed past point 3 (x about 0.45)
    const pushed = base.map((p, i) => (i === 4 ? { ...p, x: 0.6, y: p.y } : p))
    const out = clampOrder(pushed, [4])
    expect(out[4].x).toBeLessThan(out[3].x)
    expect(out[4].x).toBeGreaterThan(out[5].x)
  })

  it('keeps both surfaces in order after a large bend', () => {
    const base = naca4Points('2412')
    const out = bendSegment(base, 3, 0.5, { x: 0.2, y: 0 })
    const { upper, lower } = surfaceXs(out)
    for (let k = 1; k < upper.length; k++) expect(upper[k], `upper ${k}`).toBeLessThan(upper[k - 1])
    for (let k = 1; k < lower.length; k++) expect(lower[k], `lower ${k}`).toBeGreaterThan(lower[k - 1])
  })

  it('does not mutate its inputs', () => {
    const base = naca4Points('2412')
    const snap = JSON.parse(JSON.stringify(base))
    bendSegment(base, 3, 0.5, { x: 0.01, y: 0.01 })
    moveStraightSegment(base, 3, { x: 0.01, y: 0.01 }, 'along')
    clampOrder(base, [4])
    expect(base).toEqual(snap)
  })
})
