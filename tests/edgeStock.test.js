import { describe, it, expect } from 'vitest'
import { defaultState, migrate } from '../src/lib/projects.js'
import { resolveAirfoil, airfoilPerformance } from '../src/lib/airfoils.js'
import { wingGeometry } from '../src/lib/calc.js'
import { wingSampler, projectedSampler } from '../src/lib/wing.js'
import { analyseStructure, defaultStructure } from '../src/lib/structure.js'
import { buildParts, bounds } from '../src/lib/ribs.js'
import { cutListCsv } from '../src/lib/dxf.js'
import { LE_STOCK, TE_STOCK, resolveEdges, lengthsToBuy } from '../src/lib/edgeStock.js'

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

// A symmetrical section of half-thickness h(xi) · c, for checking fits by hand
function plainSection(c, h) {
  const sec = { c, surf: (xi) => ({ upper: h(xi) * c, lower: -h(xi) * c }) }
  return () => sec
}

describe('edge stock', () => {
  it('auto picks stock that carves to the section, with the least waste', () => {
    const { a } = build()
    const { le, te } = a.edges
    expect(LE_STOCK).toContain(le.item)
    expect(TE_STOCK).toContain(te.item)
    expect(le.fits).toBe(true)
    expect(te.fits).toBe(true)
    // Deep enough along the chord: 6 mm or 2.5% of the 250 mm root, and 5% for the TE
    expect(le.item.width).toBeGreaterThanOrEqual(0.00625 - 1e-9)
    expect(te.item.width).toBeGreaterThanOrEqual(0.0125 - 1e-9)
    expect(a.warnings.some((w) => w.id === 'le-stock' || w.id === 'te-stock')).toBe(false)
  })

  it('prefers a strip on edge when it wastes less than a square profile', () => {
    // A nose that keeps thickening: 12 mm deep 6.5 mm back on a 250 mm chord fits L262
    // (6.5 × 12.5) on edge, but a profile has to be 25 mm to stay ahead of it, which wastes more
    const section = plainSection(0.25, (xi) => 0.024 * Math.sqrt(xi / 0.026))
    const e = resolveEdges({ le: { stock: 'auto' }, te: { stock: 'custom', width: 0.015 } }, section, [0])
    expect(e.le.item.code).toBe('L262')
    expect(e.le.fits).toBe(true)
  })

  it('checks the whole profile, not just the rib face', () => {
    // A blunt nose: full depth almost at once. A symmetrical (rounded) profile as tall as the
    // section at the rib face can't contain it; a plain strip of the same size can.
    const section = plainSection(0.25, (xi) => (xi > 0 ? 0.022 : 0))
    const sym = LE_STOCK.find((x) => x.code === 'L345')
    const strip = LE_STOCK.find((x) => x.code === 'L280')
    const fit = (id) => resolveEdges({ le: { stock: id }, te: { stock: 'custom', width: 0.015 } }, section, [0]).le
    expect(fit(sym.id).fits).toBe(false)
    expect(fit(strip.id).fits).toBe(true)
  })

  it('cuts the ribs back by the chosen stock', () => {
    const res = build((st) => {
      st.le.stock = 'L340'
      st.te.stock = 'L441'
    })
    const r1 = res.parts.find((p) => p.group === 'ribs')
    const b = bounds(r1.outline)
    expect(b.x0).toBeCloseTo(0.0125, 6)
    expect(b.x1).toBeCloseTo(0.25 - 0.025, 6)
  })

  it('warns when the chosen stock is too small to carve to the section, and suggests the auto pick', () => {
    const { a } = build((st) => {
      st.te.stock = 'L421'
      st.le.stock = 'L320'
    })
    const te = a.warnings.find((w) => w.id === 'te-stock')
    const le = a.warnings.find((w) => w.id === 'le-stock')
    expect(te?.message).toMatch(/^L421 triangular trailing edge is too small/)
    expect(te.message).toContain(`try ${a.edges.te.auto.code}`)
    expect(le?.message).toMatch(/^L320 flat leading edge is too small/)
  })

  it('names the part in the cut list and says how many lengths to buy', () => {
    const { cutList, parts } = build((st) => {
      st.le.stock = 'L345'
      st.te.stock = 'L440'
    })
    const le = cutList.filter((c) => c.edge === 'le')
    const te = cutList.filter((c) => c.edge === 'te')
    expect(le[0].item).toMatch(/L345 symmetrical/)
    expect(te[0].item).toMatch(/L440 triangular/)
    expect(te[0].size).toEqual([0.019, 0.0065])
    expect(le[0].note).toMatch(/^Buy \d+ × 915 mm length/)
    expect(cutListCsv(parts, cutList)).toContain('Triangular section; Buy')
  })

  it('keeps the width as entered for custom stock', () => {
    const { a } = build((st) => {
      st.le.stock = 'custom'
      st.le.width = 0.008
    })
    expect(a.structure.le.width).toBe(0.008)
    expect(a.edges.le.item).toBe(null)
  })

  it('keeps older saves on their own widths', () => {
    const old = defaultState()
    old.input.structure.le = { width: 0.007, material: 'balsa-hard' }
    old.input.structure.te = { width: 0.02, type: 'flat', material: 'balsa-medium' }
    const m = migrate(JSON.parse(JSON.stringify(old)))
    expect(m.input.structure.le.stock).toBe('custom')
    expect(m.input.structure.te.stock).toBe('custom')
    expect(m.input.structure.te.type).toBe('flat')
    // New projects start on auto
    expect(migrate({}).input.structure.le.stock).toBe('auto')
  })

  it('packs pieces into stock lengths', () => {
    expect(lengthsToBuy([0.5, 0.4])).toBe(1)
    expect(lengthsToBuy([0.5, 0.5])).toBe(2)
    expect(lengthsToBuy([0.6, 0.6, 0.3, 0.3])).toBe(2)
    // Longer than a length: joined from two
    expect(lengthsToBuy([1.2])).toBe(2)
  })
})
