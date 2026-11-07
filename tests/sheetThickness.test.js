import { describe, it, expect } from 'vitest'
import { defaultState, fillDefaults } from '../src/lib/projects.js'
import { resolveAirfoil, airfoilPerformance } from '../src/lib/airfoils.js'
import { wingGeometry } from '../src/lib/calc.js'
import { wingSampler, projectedSampler, normalisePanels } from '../src/lib/wing.js'
import { analyseStructure, defaultStructure, sheetThicknessAt, skinAt, hardPatches, patchThicknessAt } from '../src/lib/structure.js'
import { buildParts, buildRib } from '../src/lib/ribs.js'
import { patchSection, surfaceHeight, insetHeight, sectionAt, wing3d, partFor } from '../src/lib/wing3d.js'

// A two-panel wing (0.4 m then 0.3 m), the structure edited by `edit`
function build(edit = () => {}) {
  const s = defaultState()
  s.input.panels = normalisePanels([
    { length: 0.4, tipChord: 0.2, dihedral: 0 },
    { length: 0.3, tipChord: 0.14, dihedral: 0 },
  ])
  const st = defaultStructure()
  edit(st, s.input.panels)
  const airfoil = resolveAirfoil(s.airfoil)
  const g = wingGeometry({ ...s.input, mode: 'panels' })
  const planform = projectedSampler(wingSampler(s.input, airfoil.params.thickness))
  const perf = airfoilPerformance(airfoil, { mass: s.input.mass, area: g.projectedArea, chord: g.mac, wing: { planform, span: g.span, sweepCos: 1 } })
  const a = analyseStructure({ wing: s.input, airfoil, structure: st, mass: s.input.mass, spanwise: perf.spanwise })
  return { a, ...buildParts(a, a.structure) }
}
const outer = (a) => a.ribs.find((r) => r.s > a.sampler.ends[0].outer.s + 0.05)
const inner = (a) => a.ribs.find((r) => r.s > a.rootS + 0.05)

describe('sheeting thickness per panel', () => {
  it('defaults to the wing thickness everywhere, and migrates older saves to an empty map', () => {
    expect(defaultStructure().covering.panelThickness).toEqual({})
    expect(fillDefaults(defaultStructure(), { covering: { sheetThickness: 0.002 } }).covering.panelThickness).toEqual({})
    const { a } = build()
    expect(sheetThicknessAt(a.structure, outer(a).s)).toBeCloseTo(0.0015, 9)
  })

  it("gives a panel its own thickness: the skin, the ribs' inset and the sheet template", () => {
    const { a, parts } = build((st, panels) => {
      st.covering.panelThickness = { [panels[1].id]: 0.001 }
    })
    expect(sheetThicknessAt(a.structure, inner(a).s)).toBeCloseTo(0.0015, 9)
    expect(sheetThicknessAt(a.structure, outer(a).s)).toBeCloseTo(0.001, 9)
    expect(skinAt(a.structure, 0.1, 0.3, 'top', 0.15, true, outer(a).s)).toBeCloseTo(0.001, 9)
    // The rib in the outer panel is inset by the thinner sheet at its nose
    const rb = buildRib(a, a.structure, outer(a))
    const i = rb.surfaces.us.findIndex((u) => u > rb.uA + 0.01)
    expect(rb.surfaces.up[i] - rb.surfaces.upIn[i]).toBeLessThan(0.0013)
    expect(rb.surfaces.up[i] - rb.surfaces.upIn[i]).toBeGreaterThan(0.0009)
    // Each panel's templates at its own thickness
    const sheets = parts.filter((p) => p.group === 'sheeting' && /^S\d/.test(p.id))
    expect(sheets.some((p) => Math.abs(p.thickness - 0.001) < 1e-9)).toBe(true)
    expect(sheets.some((p) => Math.abs(p.thickness - 0.0015) < 1e-9)).toBe(true)
  })

  it('thinner sheeting on a panel works its sheet harder in the strength check', () => {
    const base = build()
    const thin = build((st, panels) => {
      st.covering.panelThickness = { [panels[1].id]: 0.0008 }
    })
    const at = (a) => a.stations.find((r) => r.s > a.sampler.ends[0].outer.s + 0.05)
    // Less sheet, less of the bending carried by it: the spar caps see more stress
    expect(at(thin.a).sigma).toBeGreaterThan(at(base.a).sigma)
  })
})

describe('hard-point sheeting', () => {
  const hp = (more = {}) => (st) => {
    st.covering.type = 'dbox'
    st.ribs.hardPoints = [{ id: 1, d: 0.1, to: 0.2, label: 'Joiner', sheet: 'both', ...more }]
  }

  it('counts in bending over its bays, behind the D-box sheeting', () => {
    const base = build((st) => (st.covering.type = 'dbox'))
    const { a } = build(hp({ thickness: 0.003 }))
    const inside = (x) => x.stations.find((r) => r.d > 0.13 && r.d < 0.17)
    const outside = (x) => x.stations.find((r) => r.d > 0.3)
    // Stiffer and less stressed over the hard point; the same beyond it
    expect(inside(a).EI).toBeGreaterThan(inside(base.a).EI * 1.05)
    expect(inside(a).sigma).toBeLessThan(inside(base.a).sigma)
    expect(outside(a).EI).toBeCloseTo(outside(base.a).EI, 6)
  })

  it('has its own thickness, independent of the covering', () => {
    const { a, parts } = build(hp({ thickness: 0.003 }))
    const [h] = hardPatches(a.structure, a.rootS)
    expect(h.thickness).toBeCloseTo(0.003, 9)
    expect(parts.find((p) => p.id === 'HP1T').thickness).toBeCloseTo(0.003, 9)
    // An older hard point with none of its own keeps the covering's
    const old = build(hp())
    expect(hardPatches(old.a.structure, old.a.rootS)[0].thickness).toBeCloseTo(0.0015, 9)
  })

  it("runs behind the D-box sheeting, and a rib in its bays is inset by each", () => {
    const { a } = build(hp({ thickness: 0.003, dboxThickness: 0.001 }))
    const rib = a.ribs.find((r) => r.s > a.rootS + 0.12 && r.s < a.rootS + 0.18) ?? a.ribs.find((r) => Math.abs(r.s - (a.rootS + 0.1)) < 1e-3)
    const [h] = hardPatches(a.structure, a.rootS)
    // Ahead of the spar it's the D-box's sheet (at its own thickness here); behind, the hard point's
    expect(patchThicknessAt(a.structure, h, 'top', 0.1, 0.3)).toBe(0)
    expect(patchThicknessAt(a.structure, h, 'top', 0.6, 0.3)).toBeCloseTo(0.003, 9)
    expect(sheetThicknessAt(a.structure, rib.s)).toBeCloseTo(0.001, 9)
    expect(sheetThicknessAt(a.structure, a.rootS + 0.3)).toBeCloseTo(0.0015, 9)
    const rb = buildRib(a, a.structure, rib)
    const skin = (q) => {
      const i = rb.surfaces.us.findIndex((u, k) => rb.surfaces.us[k] > 0 && u >= q * rb.length)
      return rb.surfaces.up[i] - rb.surfaces.upIn[i]
    }
    expect(skin(0.12)).toBeLessThan(0.0013)
    expect(skin(0.6)).toBeGreaterThan(0.0028)
  })

  it('draws its sheet in 3D from the D-box sheeting back', () => {
    const { a } = build(hp({ thickness: 0.003 }))
    const [h] = hardPatches(a.structure, a.rootS)
    const s = (h.s0 + h.s1) / 2
    const pts = patchSection(a, a.structure, s, 'upper', h)
    const sec = a.section(s)
    const front = Math.min(...pts.map((p) => p[0]))
    // Starts at the spar's rear face, not the leading edge
    expect(front).toBeGreaterThan(a.sparX(s) - 1e-6)
    expect(front).toBeLessThan(sec.xl + sec.c)
  })
})

describe('a covering that wants closer ribs', () => {
  it('warns when tissue is on ribs further apart than 50 mm, beside the rib spacing', () => {
    const film = build((st) => (st.covering.finish = 'film'))
    expect(film.a.warnings.some((w) => w.id === 'rib-pitch-covering')).toBe(false)
    const tissue = build((st) => (st.covering.finish = 'tissue'))
    const w = tissue.a.warnings.find((x) => x.id === 'rib-pitch-covering')
    expect(w.message).toContain('50 mm')
    // At 50 mm, no warning, and the suggestion keeps the ribs that close
    const close = build((st) => {
      st.covering.finish = 'tissue'
      st.ribs.pitch = 0.05
    })
    expect(close.a.warnings.some((x) => x.id === 'rib-pitch-covering')).toBe(false)
    const gaps = close.a.ribs.slice(1).map((r, i) => r.s - close.a.ribs[i].s)
    expect(Math.max(...gaps)).toBeLessThanOrEqual(0.05 + 1e-6)
  })
})

describe("a hard point's own sheet as its own piece", () => {
  const joiner = (cov, more = {}) => (st) => {
    st.covering.type = cov
    st.covering.sheetThickness = 0.0015
    st.ribs.hardPoints = [{ id: 1, d: 0.1, to: 0.2, label: 'Joiner', sheet: 'both', thickness: 0.003, ...more }]
  }
  const overlaps = (p, h) => p.span[0] < h.s1 - 1e-6 && p.span[1] > h.s0 + 1e-6

  it("on a fully sheeted wing, cuts the wing's sheeting to clear the hard point's sheet", () => {
    const { a, parts } = build(joiner('sheeted'))
    const [h] = hardPatches(a.structure, a.rootS)
    const sheets = parts.filter((p) => p.group === 'sheeting' && !p.id.startsWith('HP'))
    // No panel sheet runs over the hard point; its own sheets, top and bottom, do
    expect(sheets.some((p) => overlaps(p, h))).toBe(false)
    expect(sheets.filter((p) => p.surface === 'upper').length).toBeGreaterThan(2)
    for (const id of ['HP1T', 'HP1B']) expect(parts.find((p) => p.id === id).thickness).toBeCloseTo(0.003, 9)
    // The ribs, spar and stringers there are inset by its thickness, not the sheeting's
    const s = (h.s0 + h.s1) / 2
    const sec = a.section(s)
    const x = sec.xl + 0.5 * sec.c
    expect(surfaceHeight(a, s, x, 'upper') - insetHeight(a, a.structure, s, x, 'upper')).toBeCloseTo(0.003, 3)
    // In 3D and the section, its sheet alone, not the sheeting as well
    const cut = sectionAt(a, a.structure, parts, s).pieces.filter((q) => q.kind === 'sheet')
    expect(cut).toHaveLength(2)
    const w = wing3d(a, a.structure, parts)
    const panelSheets = w.solids.filter((q) => q.kind === 'sheet' && q.piece?.id.startsWith('sheet-'))
    for (const q of panelSheets) {
      const P = q.positions
      for (let i = 0; i < P.length; i += 3) {
        // Along the span is world x for this straight wing
        expect(P[i] > h.s0 + 1e-3 && P[i] < h.s1 - 1e-3, q.piece.id).toBe(false)
      }
    }
  })

  it("on a D-box, makes the hard point's own D-box thickness a piece of its own", () => {
    const { a, parts } = build(joiner('dbox', { dboxThickness: 0.0025 }))
    const [h] = hardPatches(a.structure, a.rootS)
    const sheets = parts.filter((p) => p.group === 'sheeting' && !p.id.startsWith('HP'))
    const own = sheets.filter((p) => overlaps(p, h))
    expect(own).toHaveLength(2)
    for (const p of own) {
      expect(p.thickness).toBeCloseTo(0.0025, 9)
      expect(p.span[0]).toBeCloseTo(h.s0, 6)
      expect(p.span[1]).toBeCloseTo(h.s1, 6)
      expect(p.notes[0]).toContain('over Joiner')
    }
    // The panel's sheeting either side stops at it
    for (const p of sheets.filter((q) => !own.includes(q))) expect(overlaps(p, h)).toBe(false)
    // With no thickness of its own set, still its own piece, at the panel's thickness; only on
    // the side the hard point sheets
    const same = build(joiner('dbox', { sheet: 'top' }))
    const [h2] = hardPatches(same.a.structure, same.a.rootS)
    const own2 = same.parts.filter((p) => p.group === 'sheeting' && !p.id.startsWith('HP') && overlaps(p, h2))
    expect(own2).toHaveLength(2)
    const top = own2.find((p) => p.surface === 'upper')
    expect(top.span[0]).toBeCloseTo(h2.s0, 6)
    expect(top.span[1]).toBeCloseTo(h2.s1, 6)
    expect(top.thickness).toBeCloseTo(0.0015, 9)
    // The bottom isn't split there: one sheet runs over it
    const bottom = own2.find((p) => p.surface === 'lower')
    expect(bottom.span[1] - bottom.span[0]).toBeGreaterThan(h2.s1 - h2.s0 + 0.01)
  })
})

describe('cap strips under a sheeted hard point', () => {
  it('leaves them off the ribs its sheet covers, on the sides it covers, and out of the cut list', () => {
    const edit = (sheet) => (st) => {
      st.covering.type = 'open'
      st.covering.capStrips = true
      st.ribs.hardPoints = [{ id: 1, d: 0.1, to: 0.2, label: 'Joiner', sheet, thickness: 0.003 }]
    }
    const plain = build((st) => {
      st.covering.type = 'open'
      st.covering.capStrips = true
    })
    const { a, parts, cutList } = build(edit('top'))
    const [h] = hardPatches(a.structure, a.rootS)
    const under = parts.filter((p) => p.group === 'ribs' && !p.of && p.s >= h.s0 - 1e-6 && p.s <= h.s1 + 1e-6)
    expect(under.length).toBeGreaterThanOrEqual(2)
    for (const p of under) {
      expect(p.rib.capStripTo.top, p.name).toBe(p.rib.capStripFrom.top)
      expect(p.rib.capStripTo.bottom, p.name).toBeGreaterThan(p.rib.capStripFrom.bottom)
    }
    const total = (cl) => cl.find((c) => c.item.startsWith('Cap strips')).length
    expect(total(cutList)).toBeLessThan(total(plain.cutList))
  })
})

describe('the D-box sheet over a hard point in 3D', () => {
  it('is a piece of its own, matching its part', () => {
    const { a, parts } = build((st) => {
      st.covering.type = 'dbox'
      st.ribs.hardPoints = [{ id: 1, d: 0.1, to: 0.2, label: 'Joiner', sheet: 'top', thickness: 0.003 }]
    })
    const [h] = hardPatches(a.structure, a.rootS)
    const w = wing3d(a, a.structure, parts)
    const tops = w.solids.filter((q) => q.kind === 'sheet' && q.piece?.id.startsWith('sheet-upper'))
    const over = tops.filter((q) => q.piece.at > h.s0 && q.piece.at < h.s1)
    expect(over).toHaveLength(1)
    // Picked, it's the hard point's own D-box part
    const part = partFor(parts, { groups: ['sheeting'], surface: 'upper' }, over[0].piece.at)
    const p = parts.find((x) => x.id === part)
    expect(p.span[0]).toBeCloseTo(h.s0, 6)
    expect(p.span[1]).toBeCloseTo(h.s1, 6)
    // The bottom sheet, which the hard point doesn't sheet, isn't split there
    const bottoms = w.solids.filter((q) => q.kind === 'sheet' && q.piece?.id.startsWith('sheet-lower'))
    expect(bottoms.length).toBeLessThan(tops.length)
  })
})
