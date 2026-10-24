import { describe, it, expect } from 'vitest'
import { defaultState, fillDefaults } from '../src/lib/projects.js'
import { resolveAirfoil, airfoilPerformance } from '../src/lib/airfoils.js'
import { wingGeometry } from '../src/lib/calc.js'
import { wingSampler, projectedSampler, normalisePanels } from '../src/lib/wing.js'
import { analyseStructure, defaultStructure, sheetThicknessAt, skinAt, hardPatches, patchThicknessAt } from '../src/lib/structure.js'
import { buildParts, buildRib } from '../src/lib/ribs.js'
import { patchSection } from '../src/lib/wing3d.js'

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
