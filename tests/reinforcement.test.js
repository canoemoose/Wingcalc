import { describe, it, expect } from 'vitest'
import { defaultState } from '../src/lib/projects.js'
import { resolveAirfoil, airfoilPerformance } from '../src/lib/airfoils.js'
import { wingGeometry } from '../src/lib/calc.js'
import { wingSampler, projectedSampler } from '../src/lib/wing.js'
import { analyseStructure, defaultStructure, stringerSection, stringerSize, sectionElements, insideCentre } from '../src/lib/structure.js'
import { buildParts, buildRib, polygonArea, bounds } from '../src/lib/ribs.js'
import { stringerBox, insetHeight, wing3d } from '../src/lib/wing3d.js'
import { structureSection } from '../src/lib/warnings.js'

function build(edit = () => {}) {
  const s = defaultState()
  const st = defaultStructure()
  edit(st)
  const airfoil = resolveAirfoil(s.airfoil)
  const g = wingGeometry({ ...s.input, mode: 'panels' })
  const planform = projectedSampler(wingSampler(s.input, airfoil.params.thickness))
  const perf = airfoilPerformance(airfoil, { mass: s.input.mass, area: g.projectedArea, chord: g.mac, wing: { planform, span: g.span, sweepCos: 1 } })
  const a = analyseStructure({ wing: s.input, airfoil, structure: st, mass: s.input.mass, spanwise: perf.spanwise })
  return { a, ...buildParts(a, a.structure) }
}
const rod = (more = {}) => ({ id: 1, profile: 'rod', position: 0.55, surface: 'inside', depth: 0.5, width: 0.003, height: 0.003, material: 'carbon-rod', ...more })

describe('carbon reinforcement', () => {
  it('sizes each profile: rod and tube round, strip as a rectangle', () => {
    const r = stringerSection({ profile: 'rod', width: 0.004 })
    expect(r.A).toBeCloseTo((Math.PI / 4) * 0.004 ** 2, 12)
    expect(r.I0).toBeCloseTo((Math.PI / 64) * 0.004 ** 4, 18)
    const t = stringerSection({ profile: 'tube', width: 0.004, wall: 0.0005 })
    expect(t.A).toBeCloseTo((Math.PI / 4) * (0.004 ** 2 - 0.003 ** 2), 12)
    expect(stringerSection({ profile: 'strip', width: 0.006, height: 0.0005 }).A).toBeCloseTo(0.006 * 0.0005, 12)
    // A round one's height is its diameter, whatever height was left on it
    expect(stringerSize({ profile: 'rod', width: 0.003, height: 0.01 }).h).toBe(0.003)
    // An older stringer, with no profile, is the rectangle it always was
    expect(stringerSection({ width: 0.003, height: 0.002 }).A).toBeCloseTo(0.000006, 12)
  })

  it('threads a rod inside the wing through a round hole in every rib, at its height', () => {
    const { a, parts } = build((st) => (st.stringers = [rod({ depth: 0.25 })]))
    for (const p of parts.filter((q) => q.group === 'ribs')) {
      const r = p.rib
      const u = r.surfaces.us
      // No notch: the outline doesn't change, but there's a hole the rod's size
      const hole = p.holes.find((h) => {
        const b = bounds(h)
        return Math.abs(b.w - 0.0032) < 3e-4 && Math.abs(b.h - 0.0032) < 1e-4
      })
      expect(hole, p.name).toBeTruthy()
      const b = bounds(hole)
      const uc = (b.x0 + b.x1) / 2
      // A quarter of the way up the room between the skins
      const i = u.findIndex((x) => x >= uc)
      const lo = r.surfaces.loIn[i]
      const hi = r.surfaces.upIn[i]
      expect((b.y0 + b.y1) / 2).toBeCloseTo(insideCentre({ profile: 'rod', width: 0.003, depth: 0.25 }, lo, hi), 3)
      expect(b.y0).toBeGreaterThan(lo)
      expect(b.y1).toBeLessThan(hi)
    }
    // In the 3D view it's round, between the inset surfaces
    const s = (a.rootS + a.tipS) / 2
    const ring = stringerBox(a, a.structure, a.structure.stringers[0], s, 'inside')
    expect(ring).toHaveLength(16)
    const xm = ring.reduce((m, p) => m + p[0], 0) / 16
    expect(Math.min(...ring.map((p) => p[1]))).toBeGreaterThan(insetHeight(a, a.structure, s, xm, 'lower'))
    expect(Math.max(...ring.map((p) => p[1]))).toBeLessThan(insetHeight(a, a.structure, s, xm, 'upper'))
    const w = wing3d(a, a.structure, parts)
    expect(w.solids.some((x) => x.kind === 'stringer' && x.piece?.name.startsWith('Carbon rod'))).toBe(true)
  })

  it('counts it in bending at its height, and in the cut list as round stock', () => {
    const plain = build()
    const withRod = build((st) => (st.stringers = [rod({ width: 0.004 })]))
    const s = withRod.a.stations[10]
    const sec = withRod.a.section(s.s)
    const { els } = sectionElements(withRod.a.structure, sec, { sparXi: s.sparXi, leXi: 0.03, teXi: 0.95 })
    const el = els.find((e) => e.part === 'stringer')
    expect(el.surface).toBe('inside')
    expect(el.A).toBeCloseTo((Math.PI / 4) * 0.004 ** 2, 12)
    expect(withRod.a.stations[10].EI).toBeGreaterThan(plain.a.stations[10].EI)
    const line = withRod.cutList.find((c) => /Carbon rod inside the wing/.test(c.item))
    expect(line.round).toBe(true)
    expect(line.material).toBe('carbon-rod')
  })

  it('notches a carbon tube on the top skin, and warns where an inside one has no room', () => {
    const top = build((st) => (st.stringers = [rod({ profile: 'tube', surface: 'upper', position: 0.2, wall: 0.0005, material: 'carbon-tube' })]))
    const rib = top.parts.find((p) => p.group === 'ribs')
    const plainRib = build().parts.find((p) => p.group === 'ribs')
    // A notch takes area off the rib; no hole for it
    expect(Math.abs(polygonArea(rib.outline))).toBeLessThan(Math.abs(polygonArea(plainRib.outline)) - 0.003 * 0.002)
    expect(top.cutList.find((c) => /Carbon tube/.test(c.item)).tube).toBe(true)
    const big = build((st) => (st.stringers = [rod({ width: 0.02, position: 0.9 })]))
    const warn = big.a.warnings.find((x) => x.id.startsWith('stringer-fit'))
    expect(warn).toBeTruthy()
    expect(structureSection(warn.id)).toBe('stringers')
  })

  it("notches a rod on a skin round-bottomed, its sides straight up to the edge, so it pushes in", () => {
    for (const surface of ['upper', 'lower']) {
      const d = 0.004
      const res = build((st) => (st.stringers = [rod({ surface, position: 0.3, width: d, height: d })]))
      const square = build((st) => (st.stringers = [{ id: 1, profile: 'rect', surface, position: 0.3, width: d, height: d, material: 'balsa-hard' }]))
      const rib = res.parts.find((p) => p.group === 'ribs')
      const flat = square.parts.find((p) => p.group === 'ribs')
      // A round bottom takes less off the rib than a square notch the same size: the corners
      // a quarter of the square less a quarter circle each, (1 - π/4) d² over two corners
      const less = Math.abs(polygonArea(rib.outline)) - Math.abs(polygonArea(flat.outline))
      expect(less, surface).toBeGreaterThan(0)
      expect(less, surface).toBeCloseTo(((1 - Math.PI / 4) * d * d) / 2, 6)
      // Its sides are straight and its opening as wide as the rod, so it goes in from the edge:
      // points on the rib round the rod's centre lie on the rod's circle
      const us = rib.outline.map(([u]) => u)
      expect(new Set(us.map((u) => u.toFixed(6))).size).toBeGreaterThan(new Set(flat.outline.map(([u]) => u.toFixed(6))).size)
    }
  })

  it('leaves a rib built round the rod whole: the hole is inside the outline', () => {
    const { a } = build((st) => (st.stringers = [rod()]))
    const rb = buildRib(a, a.structure, a.ribs[2])
    expect(rb.ok).toBe(true)
    expect(rb.notes.some((n) => /No room/.test(n))).toBe(false)
  })
})

describe('ribs with no slivers or whiskers', () => {
  // A point where the outline runs out and straight back along itself
  const spikes = (poly) =>
    poly.filter((b, i) => {
      const a = poly[(i + poly.length - 1) % poly.length]
      const c = poly[(i + 1) % poly.length]
      const u = [b[0] - a[0], b[1] - a[1]]
      const v = [c[0] - b[0], c[1] - b[1]]
      const lu = Math.hypot(...u)
      const lv = Math.hypot(...v)
      return lu > 1e-7 && lv > 1e-7 && (u[0] * v[0] + u[1] * v[1]) / (lu * lv) < -0.995
    })

  it('cuts a rib through where a stringer pair near the trailing edge would leave a sliver', () => {
    const res = build((st) => (st.stringers = [{ id: 2, profile: 'rect', position: 0.85, surface: 'both', width: 0.01, height: 0.005, material: 'balsa-hard' }]))
    const ribs = res.parts.filter((p) => p.group === 'ribs')
    for (const p of ribs) expect(spikes(p.outline), p.id).toEqual([])
    const cut = ribs.filter((p) => !p.of && p.notes.some((n) => n.startsWith('Cut through')))
    expect(cut.length).toBeGreaterThan(0)
    for (const p of cut) {
      const back = res.parts.find((q) => q.of === p.id)
      expect(back, p.id).toBeTruthy()
      // The two pieces don't meet: a gap the width of the notches between them
      const front = Math.max(...p.outline.map(([u]) => u))
      const rear = Math.min(...back.outline.map(([u]) => u))
      expect(rear - front).toBeGreaterThan(0.009)
      expect(p.label.text).toBe(`${p.id}A`)
    }
  })

  it('leaves no zero-width spike where a hard point sheet meets the D-box at the spar', () => {
    const res = build((st) => {
      st.covering.type = 'dbox'
      st.ribs.hardPoints = [{ id: 1, d: 0, to: 0.1, label: 'Joiner', sheet: 'top', thickness: 0.002 }]
    })
    const { parts } = buildParts(res.a, res.a.structure)
    for (const p of parts.filter((q) => q.group === 'ribs')) expect(spikes(p.outline), p.id).toEqual([])
  })
})
