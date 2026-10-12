import { describe, it, expect } from 'vitest'
import { defaultState } from '../src/lib/projects.js'
import { resolveAirfoil, airfoilPerformance } from '../src/lib/airfoils.js'
import { wingGeometry } from '../src/lib/calc.js'
import { wingSampler, projectedSampler, normalisePanels } from '../src/lib/wing.js'
import { analyseStructure, defaultStructure } from '../src/lib/structure.js'
import { buildParts, bounds, polygonArea } from '../src/lib/ribs.js'
import { textWidth } from '../src/lib/strokeFont.js'

// Two segments properly cross (touching at ends doesn't count)
function crosses(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]))
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0
}
function selfIntersects(p) {
  const n = p.length
  for (let i = 0; i < n; i++)
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue
      if (crosses(p[i], p[(i + 1) % n], p[j], p[(j + 1) % n])) return true
    }
  return false
}
function inside(poly, [x, y]) {
  let c = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c
  }
  return c
}

function build(edit = () => {}, wingEdit = () => {}) {
  const s = defaultState()
  wingEdit(s.input)
  const st = defaultStructure()
  // Fixed edge widths, so the geometry checks below have known numbers
  st.le.stock = 'custom'
  st.te.stock = 'custom'
  edit(st)
  const airfoil = resolveAirfoil(s.airfoil)
  const g = wingGeometry({ ...s.input, mode: 'panels' })
  const planform = projectedSampler(wingSampler(s.input, airfoil.params.thickness))
  const perf = airfoilPerformance(airfoil, { mass: s.input.mass, area: g.projectedArea, chord: g.mac, wing: { planform, span: g.span, sweepCos: 1 } })
  const a = analyseStructure({ wing: s.input, airfoil, structure: st, mass: s.input.mass, spanwise: perf.spanwise })
  return { a, st, ...buildParts(a, st) }
}

const ribsOf = (res) => res.parts.filter((p) => p.group === 'ribs')
// Lowest point of the outline's top edge within [u0, u1], i.e. a notch bottom
const topIn = (rib, u0, u1) => {
  const pts = rib.outline.filter(([u]) => u >= u0 - 1e-9 && u <= u1 + 1e-9)
  return Math.max(...pts.map(([, z]) => z))
}

const swept = (input) => {
  input.panels = normalisePanels([
    { length: 0.5, tipChord: 0.18, sweep: 0.08, dihedral: 3, washout: 1.5 },
    { length: 0.25, tipChord: 0.1, sweep: 0.08, dihedral: 10, washout: 3, thickness: 0.09 },
  ])
  input.tip = { extension: 0.04, peak: 0.4 }
}

describe('ribs', () => {
  it('cuts each rib back for the LE and TE stock', () => {
    const res = build()
    const r1 = ribsOf(res)[0]
    const b = bounds(r1.outline)
    expect(b.x0).toBeCloseTo(0.006, 6)
    expect(b.x1).toBeCloseTo(0.25 - 0.015, 6)
  })

  it('notches the caps to their size at the spar', () => {
    const res = build()
    const r = ribsOf(res)[2]
    const [u0, u1] = r.rib.sparNotch
    // The cap's own width, square to the spar; a little wider along a rib that crosses it at an angle
    expect(u1 - u0).toBeGreaterThanOrEqual(res.st.spar.capWidth - 1e-9)
    expect(u1 - u0).toBeLessThan(res.st.spar.capWidth * 1.01)
    for (const u of [u0, u1]) {
      // At each notch wall: skin top, notch bottom, then the lower notch's top and the skin
      const zs = r.outline.filter(([x]) => Math.abs(x - u) < 1e-9).map(([, z]) => z).sort((p, q) => q - p)
      expect(zs).toHaveLength(4)
      expect(zs[0] - zs[1]).toBeCloseTo(res.st.spar.capThickness, 3)
      expect(zs[2] - zs[3]).toBeCloseTo(res.st.spar.capThickness, 3)
    }
  })

  it('makes simple outlines for every part, with holes inside them', () => {
    const variants = [
      build(),
      build((st) => {
        st.ribs.orientation = 'perpendicular'
        st.ribs.jigTabs = true
        st.ribs.lightening = true
        st.gussets.le = st.gussets.te = true
        st.stringers = [{ id: 1, position: 0.12, surface: 'both', width: 0.003, height: 0.003, material: 'balsa-hard' }]
      }, swept),
      build((st) => {
        st.spar.type = 'tube'
        st.covering.type = 'open'
        st.ribs.lightening = true
      }),
      build((st) => {
        st.spar.type = 'solid'
        st.spar.solidMount = 'through'
        st.covering.type = 'sheeted'
      }),
    ]
    for (const res of variants) {
      expect(res.skipped).toEqual([])
      for (const p of res.parts) {
        expect(p.outline.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)), p.name).toBe(true)
        expect(selfIntersects(p.outline), p.name).toBe(false)
        for (const h of p.holes) for (const pt of h) expect(inside(p.outline, pt), `${p.name} hole`).toBe(true)
      }
    }
  })

  it('treats ribs placed by hand like spaced ones: lightening holes, no end gussets', () => {
    const res = build((st) => {
      st.ribs.spacing = 'manual'
      st.ribs.manual = [0.1, 0.2, 0.3, 0.4].map((d, i) => ({ id: i + 1, d }))
      st.ribs.lightening = true
      st.gussets.le = true
      st.gussets.where = 'ends'
    })
    const manual = ribsOf(res).filter((p) => p.kind === 'manual')
    expect(manual.length).toBe(4)
    for (const p of manual) expect(p.holes.length, p.name).toBeGreaterThan(0)
    const gussets = res.parts.filter((p) => p.group === 'gussets').reduce((n, p) => n + p.qty, 0)
    expect(gussets).toBe(2 * (ribsOf(res).length - 4))
  })

  it('cuts a rib square to a swept spar shorter than the streamwise chord, by cos of the sweep', () => {
    const sweep = 0.15
    const res = build(
      (st) => (st.ribs.orientation = 'perpendicular'),
      (input) => (input.panels = normalisePanels([{ length: 0.7, tipChord: 0.25, sweep, dihedral: 0 }])),
    )
    const r = ribsOf(res).find((p) => p.kind === 'normal')
    const lambda = Math.atan(sweep / 0.7)
    expect(Math.abs(r.rib.angle)).toBeCloseTo((lambda * 180) / Math.PI, 6)
    expect(r.rib.length).toBeCloseTo(0.25 * Math.cos(lambda), 6)
    // Root and tip stay streamwise so they meet the fuselage and tip cleanly
    for (const p of ribsOf(res).filter((q) => q.kind !== 'normal')) expect(p.rib.angle).toBeCloseTo(0, 9)
  })

  it('puts every jig tab of a panel on one board line', () => {
    const res = build((st) => (st.ribs.jigTabs = true), swept)
    const byBoard = new Map()
    for (const p of ribsOf(res)) {
      const low = Math.min(...p.outline.map(([, z]) => z))
      const key = [...res.boards.entries()].find(([, v]) => Math.abs(v - low) < 1e-9)?.[0]
      expect(key, p.name).toBeDefined()
      byBoard.set(key, (byBoard.get(key) ?? 0) + 1)
      expect(p.etch.length).toBe(2)
    }
    expect(byBoard.size).toBeGreaterThanOrEqual(2)
  })

  it('builds washout in: the trailing edge sits higher on a twisted rib', () => {
    const flat = build()
    const twisted = build(() => {}, (input) => (input.panels = normalisePanels([{ length: 0.7, tipChord: 0.18, dihedral: 0, washout: 4 }])))
    const tipOf = (res) => ribsOf(res).at(-1)
    const rise = (p) => {
      const pts = p.outline
      const front = pts.filter(([u]) => Math.abs(u - p.rib.uA) < 1e-9).map(([, z]) => z)
      const back = pts.filter(([u]) => Math.abs(u - p.rib.uB) < 1e-9).map(([, z]) => z)
      return (Math.max(...back) + Math.min(...back)) / 2 - (Math.max(...front) + Math.min(...front)) / 2
    }
    expect(rise(tipOf(twisted)) - rise(tipOf(flat))).toBeGreaterThan(0.18 * 0.9 * Math.sin((4 * Math.PI) / 180) * 0.8)
  })

  it('counts a centre rib once for a pair, and everything else twice', () => {
    const res = build()
    const ribs = ribsOf(res)
    expect(ribs[0].qty).toBe(1)
    expect(ribs.slice(1).every((p) => p.qty === 2)).toBe(true)
    const right = buildParts(res.a, res.st, { handedness: 'right' })
    expect(right.parts.every((p) => p.qty === 1 || p.group === 'braces')).toBe(true)
  })

  it('sizes dihedral braces for the bending at the break', () => {
    const res = build(() => {}, swept)
    const braces = res.parts.filter((p) => p.group === 'braces')
    expect(braces.length).toBe(2) // centreline and the polyhedral break
    for (const b of braces) expect(b.thickness).toBeGreaterThanOrEqual(b.need - 1e-9)
    expect(braces[0].qty).toBe(2) // centreline: one each side of the spar, shared by both halves
    expect(braces[1].qty).toBe(4)
  })

  it('estimates a plausible structure weight', () => {
    const res = build()
    // A 1.4 m D-box wing's bare structure: somewhere around 100 to 250 g
    expect(res.weight.total).toBeGreaterThan(0.1)
    expect(res.weight.total).toBeLessThan(0.25)
    const ribArea = ribsOf(res).reduce((s, p) => s + Math.abs(polygonArea(p.outline)) * p.qty, 0)
    expect(ribArea).toBeGreaterThan(0)
  })

  it('keeps each label clear of the lightening holes and inside the rib', () => {
    for (const orientation of ['streamwise', 'perpendicular']) {
      const res = build(
        (st) => {
          st.ribs.lightening = true
          st.ribs.orientation = orientation
          st.spar.type = 'tube'
        },
        swept,
      )
      for (const p of ribsOf(res)) {
        const l = p.label
        const box = { x0: l.u, x1: l.u + textWidth(l.text, l.h), y0: l.z, y1: l.z + l.h }
        for (const corner of [
          [box.x0, box.y0],
          [box.x1, box.y0],
          [box.x0, box.y1],
          [box.x1, box.y1],
        ]) {
          expect(inside(p.outline, corner), `${p.name} ${orientation} label inside`).toBe(true)
        }
        for (const h of p.holes) {
          const hb = bounds(h)
          const overlaps = box.x0 < hb.x1 && box.x1 > hb.x0 && box.y0 < hb.y1 && box.y1 > hb.y0
          expect(overlaps, `${p.name} ${orientation} label over a hole`).toBe(false)
        }
        expect(l.h).toBeGreaterThanOrEqual(0.0015)
      }
    }
  })
})
