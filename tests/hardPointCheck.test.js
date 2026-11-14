// Sheeted hard points in the strength check: counted where they're built, in their own
// material, and checked themselves; and the spar's fit inside each side's own skin.
import { describe, it, expect } from 'vitest'
import { defaultState } from '../src/lib/projects.js'
import { resolveAirfoil, airfoilPerformance } from '../src/lib/airfoils.js'
import { wingGeometry } from '../src/lib/calc.js'
import { wingSampler, projectedSampler } from '../src/lib/wing.js'
import { analyseStructure, defaultStructure, hardPatches, sparSection } from '../src/lib/structure.js'
import { newSurface, defaultControls } from '../src/lib/controlSurfaces.js'
import { buildParts } from '../src/lib/ribs.js'

function analyse(edit = () => {}, controls = defaultControls()) {
  const s = defaultState()
  const st = defaultStructure()
  edit(st)
  const airfoil = resolveAirfoil(s.airfoil)
  const g = wingGeometry({ ...s.input, mode: 'panels' })
  const planform = projectedSampler(wingSampler(s.input, airfoil.params.thickness))
  const perf = airfoilPerformance(airfoil, { mass: s.input.mass, area: g.projectedArea, chord: g.mac, wing: { planform, span: g.span, sweepCos: 1 } })
  return analyseStructure({ wing: s.input, airfoil, structure: st, mass: s.input.mass, spanwise: perf.spanwise, controls })
}
const hp = (extra = {}) => ({ id: 1, d: 0.1, to: 0.3, label: 'Joiner', sheet: 'both', thickness: 0.0004, ...extra })
const inside = (a) => a.stations.filter((r) => r.d > 0.12 && r.d < 0.28)

describe('sheeted hard points in the strength check', () => {
  it("takes a hard point's own material, the sheeting's without one", () => {
    const st = defaultStructure()
    st.covering.sheetMaterial = 'balsa-light'
    st.ribs.hardPoints = [hp(), hp({ id: 2, d: 0.4, to: 0.5, material: 'ply-birch' })]
    const [a, b] = hardPatches(st, 0)
    expect(a.material).toBe('balsa-light')
    expect(b.material).toBe('ply-birch')
  })

  it('checks the sheet itself on an open wing, where there is no other sheeting', () => {
    const open = (st) => { st.covering.type = 'open' }
    const without = analyse(open)
    const withHp = analyse((st) => { open(st); st.ribs.hardPoints = [hp()] })
    expect(inside(without).every((r) => r.ms.sheet === undefined)).toBe(true)
    // Crushing, with a margin of its own, and a rib spacing limit from buckling between ribs
    expect(inside(withHp).every((r) => Number.isFinite(r.ms.sheet))).toBe(true)
    expect(inside(withHp).some((r) => Number.isFinite(r.limit) && r.limit < inside(without).find((q) => Math.abs(q.d - r.d) < 1e-9).limit)).toBe(true)
  })

  it('stops counting the sheet at the fixed hinge spar beside a control surface', () => {
    const open = (st) => { st.covering.type = 'open'; st.ribs.hardPoints = [hp({ d: 0.36, to: 0.6, thickness: 0.002 })] }
    const plain = analyse(open)
    const controls = { ...defaultControls(), surfaces: [newSurface('aileron', 1, 0.35, 0.65, 1)], bays: [{ surface: 1, enabled: false }] }
    const beside = analyse(open, controls)
    const at = (a) => a.stations.find((r) => r.d > 0.45 && r.d < 0.5)
    // Less sheet in the section, so it's a little less stiff
    expect(at(beside).EI).toBeLessThan(at(plain).EI)
  })
})

describe("the spar's fit inside the skins", () => {
  it("allows for each side's own skin on a D-box sheeted short of the spar on top", () => {
    const st = defaultStructure()
    st.covering.type = 'dbox'
    st.covering.sheetThickness = 0.0015
    st.covering.capStrips = false
    const full = sparSection(st, 0.03, 0, null, 0.35).inner
    st.covering.dbox = { ...st.covering.dbox, topTo: 0.2 }
    const short = sparSection(st, 0.03, 0, null, 0.35).inner
    expect(full).toBeCloseTo(0.03 - 0.003, 9)
    expect(short).toBeCloseTo(0.03 - 0.0015, 9)
  })
})

describe("a sheeted hard point's part", () => {
  const sheet = (st) => { st.covering.type = 'open'; st.ribs.hardPoints = [hp({ d: 0.2, to: 0.5, thickness: 0.002, sheet: 'top' })] }
  const outlineOf = (a) => buildParts(a, a.structure, {}).parts.find((p) => p.id === 'HP1T').outline
  const depthAt = (pts, u) => {
    const vs = pts.filter(([x]) => Math.abs(x - u) < 1e-4).map(([, v]) => v)
    return Math.max(...vs) - Math.min(...vs)
  }

  it('is its plan shape: a plain quadrilateral where nothing interrupts it', () => {
    const pts = outlineOf(analyse(sheet))
    expect(pts.length).toBe(4)
    expect(depthAt(pts, 0)).toBeGreaterThan(0.1)
  })

  it('steps in to the fixed hinge spar where a control surface starts part way along it', () => {
    // The aileron starts 0.35 m out: inside the hard point, which runs from 0.2 to 0.5
    const controls = { ...defaultControls(), surfaces: [newSurface('aileron', 1, 0.35, 0.65, 1)], bays: [{ surface: 1, enabled: false }] }
    const a = analyse(sheet, controls)
    const pts = outlineOf(a)
    const sf = a.surfaces.find((x) => x.ok)
    const step = sf.s0 - a.rootS - 0.2
    expect(step).toBeGreaterThan(0.05)
    expect(step).toBeLessThan(0.25)
    // Two points on the rear edge at the step, one each side of it, and the sheet shallower
    // outboard of it than inboard
    const atStep = pts.filter(([u]) => Math.abs(u - step) < 1e-4)
    expect(atStep.length).toBe(2)
    expect(Math.abs(atStep[0][1] - atStep[1][1])).toBeGreaterThan(0.02)
    expect(depthAt(pts, 0.3)).toBeLessThan(depthAt(pts, 0) - 0.02)
  })
})
