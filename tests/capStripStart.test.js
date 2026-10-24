import { describe, it, expect } from 'vitest'
import { defaultState } from '../src/lib/projects.js'
import { resolveAirfoil, airfoilPerformance } from '../src/lib/airfoils.js'
import { wingGeometry } from '../src/lib/calc.js'
import { wingSampler, projectedSampler } from '../src/lib/wing.js'
import { analyseStructure, defaultStructure, capStripStart, skinAtSpar } from '../src/lib/structure.js'
import { buildParts, buildRib } from '../src/lib/ribs.js'
import { fillDefaults } from '../src/lib/projects.js'

// Same build as dbox.test.js, with the structure edited by `edit`
function build(edit = () => {}) {
  const s = defaultState()
  const st = defaultStructure()
  edit(st)
  const airfoil = resolveAirfoil(s.airfoil)
  const g = wingGeometry({ ...s.input, mode: 'panels' })
  const planform = projectedSampler(wingSampler(s.input, airfoil.params.thickness))
  const perf = airfoilPerformance(airfoil, { mass: s.input.mass, area: g.projectedArea, chord: g.mac, wing: { planform, span: g.span, sweepCos: 1 } })
  const a = analyseStructure({ wing: s.input, airfoil, structure: st, mass: s.input.mass, spanwise: perf.spanwise })
  return { a, g, ...buildParts(a, a.structure) }
}
const open = (start) => (st) => {
  st.covering.type = 'open'
  st.covering.capStrips = true
  st.covering.capStripStart = start
}

describe('cap strip start', () => {
  it('defaults to null, so strips start behind the leading-edge stock', () => {
    expect(defaultStructure().covering.capStripStart).toBeNull()
  })

  it('with null, starts at the leading-edge stock depth as a fraction of the chord', () => {
    const st = defaultStructure()
    const chord = 0.2
    expect(capStripStart({ ...st, covering: { ...st.covering, capStripStart: null }, le: { ...st.le, width: 0.006 } }, chord)).toBeCloseTo(0.03, 6)
  })

  it('with null, a rib starts its cap strips at the leading-edge stock, not the nose', () => {
    const { a } = build(open(null))
    const rib = a.ribs[0]
    const rb = buildRib(a, a.structure, rib)
    // The stock's depth sets the start: its cut-back, in metres from the rib's leading edge
    expect(rb.capStripFrom.top).toBeGreaterThan(0)
    expect(rb.capStripFrom.top).toBeCloseTo(a.structure.le.width, 3)
    expect(rb.capStripFrom.bottom).toBeCloseTo(a.structure.le.width, 3)
  })

  it('with a number, keeps the fraction of the chord it has always used', () => {
    const { a } = build(open(0.1))
    const rib = a.ribs[0]
    const rb = buildRib(a, a.structure, rib)
    expect(rb.capStripFrom.top).toBeCloseTo(0.1 * a.section(rib.s).c, 3)
  })

  it('leaves the spar skin on a D-box judged at the spar, not the nose', () => {
    const st = defaultStructure()
    st.covering.type = 'dbox'
    st.covering.capStrips = true
    st.covering.capStripStart = null
    st.covering.capStripThickness = 0.0005
    st.covering.dbox = { top: 0, bottom: 0 }
    const { a } = build((x) => Object.assign(x, st))
    // Spar skin is finite and not negative; the nose isn't read for it
    expect(skinAtSpar(a.structure, 'top')).toBeGreaterThanOrEqual(0)
  })

  it('runs full cap strips on a D-box surface with no sheeting, whatever start an older save set', () => {
    const dbox = (start) => (st) => {
      st.covering.type = 'dbox'
      st.covering.capStrips = true
      st.covering.capStripStart = start
      st.covering.dbox = { top: true, bottom: false, topTo: null, bottomTo: null }
    }
    const set = build(dbox(0.1))
    const none = build(dbox(null))
    const rib = set.a.ribs[0]
    const a = buildRib(set.a, set.a.structure, rib)
    const b = buildRib(none.a, none.a.structure, rib)
    // The unsheeted bottom starts behind the leading-edge stock, not at 10% chord
    expect(a.capStripFrom.bottom).toBeCloseTo(b.capStripFrom.bottom, 6)
    expect(a.capStripFrom.bottom).toBeLessThan(0.1 * set.a.section(rib.s).c - 0.002)
    // The sheeted top still starts behind its sheeting
    expect(a.capStripFrom.top).toBeGreaterThan(a.capStripFrom.bottom)
    expect(capStripStart(set.a.structure, 0.2)).toBeCloseTo(capStripStart(none.a.structure, 0.2), 9)
  })

  it('keeps null through a save and migration, and fills it in for an older save', () => {
    const d = defaultStructure()
    expect(fillDefaults(d, { covering: { capStripStart: null } }).covering.capStripStart).toBeNull()
    expect(fillDefaults(d, { covering: { type: 'open' } }).covering.capStripStart).toBeNull()
    expect(fillDefaults(d, { covering: { capStripStart: 0.15 } }).covering.capStripStart).toBe(0.15)
  })
})
