import { describe, it, expect } from 'vitest'
import { defaultState, migrate } from '../src/lib/projects.js'
import { resolveAirfoil, airfoilPerformance } from '../src/lib/airfoils.js'
import { wingGeometry } from '../src/lib/calc.js'
import { wingSampler, projectedSampler } from '../src/lib/wing.js'
import { analyseStructure, defaultStructure, sheetExtent, hardPatches } from '../src/lib/structure.js'
import { buildParts, buildRib } from '../src/lib/ribs.js'

// Same build as covering.test.js, with the structure edited by `edit`
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
const margins = (a) => Object.fromEntries(Object.entries(a.summary.modes).map(([k, v]) => [k, v.ms]))
const dboxEdit = (top, bottom, topTo = null, bottomTo = null) => (st) => {
  st.covering.type = 'dbox'
  st.covering.dbox = { top, bottom, topTo, bottomTo }
}

describe('D-box sheeting per surface', () => {
  it('default dbox matches explicit both-to-spar exactly', () => {
    const def = build()
    const exp = build(dboxEdit(true, true, null, null))
    expect(def.a.ribs.length).toBe(exp.a.ribs.length)
    def.a.ribs.forEach((rb, i) => {
      expect(buildRib(def.a, def.a.structure, rb).capStripFrom).toEqual(buildRib(exp.a, exp.a.structure, exp.a.ribs[i]).capStripFrom)
    })
    expect(def.covered).toEqual(exp.covered)
    expect(margins(def.a)).toEqual(margins(exp.a))
    expect(def.a.structure.covering.dbox).toEqual({ top: true, bottom: true, topTo: null, bottomTo: null })
  })

  it('top-only leaves the bottom rib edge un-inset and gives the bottom cap strips from short of the LE', () => {
    const { a } = build(dboxEdit(true, false))
    const rb = buildRib(a, a.structure, a.ribs[Math.floor(a.ribs.length / 2)])
    // Bottom sheeting off: the bottom cap strip starts short of the leading edge, ahead of the top's
    expect(rb.capStripFrom.bottom).toBeGreaterThan(rb.uA)
    expect(rb.capStripFrom.bottom).toBeLessThan(rb.capStripFrom.top)
    // Top still runs to the spar, so its cap strip starts there
    expect(rb.capStripFrom.top).toBeGreaterThan(rb.uA)
    expect(sheetExtent(a.structure, 'bottom', 0.3)).toBeNull()
    expect(sheetExtent(a.structure, 'top', 0.3)).toEqual({ from: 0, to: 0.3 })
  })

  it('topTo past the spar extends the top sheet beyond the spar', () => {
    const st = defaultStructure()
    st.covering.type = 'dbox'
    st.covering.dbox = { top: true, bottom: true, topTo: 0.4, bottomTo: null }
    const ext = sheetExtent(st, 'top', 0.3)
    expect(ext.from).toBe(0)
    expect(ext.to).toBeCloseTo(0.4, 6)
    expect(ext.to).toBeGreaterThan(0.3)
    // The bottom still stops at the spar
    expect(sheetExtent(st, 'bottom', 0.3)).toEqual({ from: 0, to: 0.3 })
  })

  it('covered sheeting falls when one side is off', () => {
    const both = build().covered.sheeted
    const oneOff = build(dboxEdit(true, false)).covered.sheeted
    expect(oneOff).toBeLessThan(both)
    expect(oneOff).toBeGreaterThan(0)
  })

  it('an older save with no dbox settings migrates to both sides to the spar', () => {
    const old = JSON.parse(JSON.stringify(defaultState()))
    delete old.input.structure.covering.dbox
    const migrated = migrate(old)
    expect(migrated.input.structure.covering.dbox).toEqual({ top: true, bottom: true, topTo: null, bottomTo: null })
  })
})

describe('cap strips on an open structure', () => {
  const open = (start) => (st) => {
    st.covering.type = 'open'
    st.covering.capStrips = true
    st.covering.capStripStart = start
  }
  it('stop short of the leading edge, at capStripStart of the chord', () => {
    const { a } = build(open(0.1))
    const rib = a.ribs[0]
    const rb = buildRib(a, a.structure, rib)
    const c = a.section(rib.s).c
    expect(rb.capStripFrom.top).toBeCloseTo(0.1 * c, 3)
    expect(rb.capStripFrom.bottom).toBeCloseTo(0.1 * c, 3)
  })
  it("leave the rib's nose at the full section ahead of them", () => {
    const short = build(open(0.1)).a
    const full = build(open(0)).a
    const area = (o) => Math.abs(o.reduce((s, [x1, y1], i) => { const [x2, y2] = o[(i + 1) % o.length]; return s + x1 * y2 - x2 * y1 }, 0)) / 2
    const r1 = buildRib(short, short.structure, short.ribs[0]).outline
    const r0 = buildRib(full, full.structure, full.ribs[0]).outline
    // The nose isn't inset by the strips, so the rib is a little bigger
    expect(area(r1)).toBeGreaterThan(area(r0))
  })
})

describe('sheeted hard points', () => {
  // An open wing without cap strips, so the patch's sheeting is all that insets the ribs
  const hp = (extra) => (st) => {
    st.covering.type = 'open'
    st.covering.capStrips = false
    st.ribs.hardPoints = [{ id: 1, d: 0.1, label: 'Undercarriage', ...extra }]
  }
  it('put a rib at each end of a hard point that runs between two distances', () => {
    const one = build(hp({}))
    const two = build(hp({ to: 0.2 }))
    const hard = (r) => r.a.ribs.filter((x) => x.kind === 'hard').map((x) => x.s - r.a.rootS)
    expect(hard(one)).toHaveLength(1)
    expect(hard(two).map((d) => Math.round(d * 1000))).toEqual([100, 200])
  })
  it('sheet between them over part of the chord, insetting the ribs there and adding a template', () => {
    const plain = build(hp({ to: 0.2 }))
    const sheeted = build(hp({ to: 0.2, sheet: 'top', chordFrom: 0.2, chordTo: 0.6 }))
    expect(hardPatches(sheeted.a.structure, sheeted.a.rootS)).toMatchObject([{ sides: ['top'], from: 0.2, to: 0.6 }])
    const tmpl = sheeted.parts.filter((p) => /^HP1/.test(p.id))
    expect(tmpl.map((p) => p.id)).toEqual(['HP1T'])
    expect(sheeted.weight.total).toBeGreaterThan(plain.weight.total)
    // The rib at the hard point is inset on top within the patch, so it's a little smaller
    const area = (o) => Math.abs(o.reduce((s, [x1, y1], i) => { const [x2, y2] = o[(i + 1) % o.length]; return s + x1 * y2 - x2 * y1 }, 0)) / 2
    const ribAt = (r) => r.a.ribs.find((x) => x.kind === 'hard')
    const a0 = area(buildRib(plain.a, plain.a.structure, ribAt(plain)).outline)
    const a1 = area(buildRib(sheeted.a, sheeted.a.structure, ribAt(sheeted)).outline)
    expect(a1).toBeLessThan(a0)
  })
  it('ignore sheeting on a hard point without a second distance', () => {
    expect(hardPatches({ ribs: { hardPoints: [{ id: 1, d: 0.1, sheet: 'both' }] } }, 0)).toEqual([])
  })
})
