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

  it('leaves a rib built round the rod whole: the hole is inside the outline', () => {
    const { a } = build((st) => (st.stringers = [rod()]))
    const rb = buildRib(a, a.structure, a.ribs[2])
    expect(rb.ok).toBe(true)
    expect(rb.notes.some((n) => /No room/.test(n))).toBe(false)
  })
})
