import { describe, it, expect } from 'vitest'
import { defaultState, migrate } from '../src/lib/projects.js'
import { resolveAirfoil, airfoilPerformance } from '../src/lib/airfoils.js'
import { wingGeometry } from '../src/lib/calc.js'
import { wingSampler, projectedSampler } from '../src/lib/wing.js'
import { analyseStructure, defaultStructure } from '../src/lib/structure.js'
import { buildParts, bounds } from '../src/lib/ribs.js'
import { cutListCsv } from '../src/lib/dxf.js'
import { LE_STOCK, TE_STOCK, resolveEdges, lengthsToBuy, roundFitAt, migrateLeStockId } from '../src/lib/edgeStock.js'
import { sectionAt as sectionIn3d, leSection } from '../src/lib/wing3d.js'

function build(edit = () => {}, wingEdit = () => {}) {
  const s = defaultState()
  wingEdit(s.input)
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

  it('reads a retired flat leading-edge code as the symmetrical stock of the same size', () => {
    expect(migrateLeStockId('L320')).toBe('L325')
    expect(migrateLeStockId('L360')).toBe('L365')
    expect(migrateLeStockId('auto')).toBe('auto')
    expect(LE_STOCK.some((x) => x.kind === 'flat')).toBe(false)
    const res = build((st) => {
      st.le.stock = 'L340'
    })
    expect(res.a.edges.le.item.id).toBe('L345')
  })

  it('checks a custom leading edge at its depth and height', () => {
    const tall = build((st) => {
      st.le.stock = 'custom'
      st.le.width = 0.01
      st.le.height = 0.03
    }).a.edges.le
    expect(tall.item).toMatchObject({ kind: 'symmetrical', width: 0.01, height: 0.03 })
    expect(tall.fits).toBe(true)
    const flat = build((st) => {
      st.le.stock = 'custom'
      st.le.width = 0.01
      st.le.height = 0.002
    }).a.edges.le
    expect(flat.fits).toBe(false)
  })

  it('cuts the ribs back by the chosen stock', () => {
    const res = build((st) => {
      st.le.stock = 'L345'
      st.te.stock = 'L441'
    })
    const r1 = res.parts.find((p) => p.group === 'ribs')
    const b = bounds(r1.outline)
    expect(b.x0).toBeCloseTo(0.0125, 6)
    expect(b.x1).toBeCloseTo(0.25 - 0.025, 6)
  })

  it('warns when the chosen stock is too small to carve to the section, says where, and suggests the auto pick', () => {
    const { a } = build((st) => {
      st.te.stock = 'L421'
      st.le.stock = 'custom'
      st.le.width = 0.003
      st.le.height = 0.003
    })
    const te = a.warnings.find((w) => w.id === 'te-stock')
    const le = a.warnings.find((w) => w.id === 'le-stock')
    expect(te?.message).toMatch(/^The trailing edge stock \(L421 triangular\) is too small to carve the wing's trailing edge from at the (root|tip) rib: it falls about [\d.]+ mm short of the section/)
    expect(te.message).toContain(`Use ${a.edges.te.auto.code} triangular (what Auto picks)`)
    expect(le?.message).toMatch(/^The leading edge stock \(3 × 3 mm custom symmetrical\) is too small to carve the wing's nose from/)
    expect(le.message).not.toMatch(/carve to the section|TE|LE/)
  })

  it('draws the fit where it is worst, red where the stock falls short', () => {
    const bad = build((st) => {
      st.le.stock = 'custom'
      st.le.width = 0.003
      st.le.height = 0.003
    }).a.edges.le
    expect(bad.drawing.fits).toBe(false)
    expect(bad.drawing.short.length).toBeGreaterThan(0)
    expect(bad.drawing.where).toMatch(/rib/)
    // The red area is the section outside the stock: as thick as the shortfall, give or take
    // how it's split between the top and the bottom
    const thick = Math.max(...bad.drawing.short.map((p) => Math.max(...p.map(([, z]) => z)) - Math.min(...p.map(([, z]) => z))))
    expect(thick).toBeGreaterThan(bad.shortfall / 3)
    expect(thick).toBeLessThan(bad.shortfall * 1.5)
    const good = build().a.edges
    expect(good.le.drawing.short.length).toBe(0)
    expect(good.te.drawing.short.length).toBe(0)
    // Trailing edge drawn forward of the trailing edge, as negative x
    expect(good.te.drawing.x0).toBeLessThan(0)
    expect(good.te.drawing.x1).toBe(0)
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
    // No height entered: as tall as it is deep
    expect(a.edges.le.item).toMatchObject({ custom: true, width: 0.008, height: 0.008 })
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

// Two segments properly cross (touching at ends doesn't count)
function selfIntersects(p) {
  const o = (a, b, c) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]))
  const crosses = (a, b, c, d) => o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0
  const n = p.length
  for (let i = 0; i < n; i++)
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue
      if (crosses(p[i], p[(i + 1) % n], p[j], p[(j + 1) % n])) return true
    }
  return false
}

describe('round and no leading edge', () => {
  const ribs = (res) => res.parts.filter((p) => p.group === 'ribs')

  it('fits a rod only if the section contains it, and finds the largest that does', () => {
    // At most 6 mm deep, with a rounded nose
    const section = plainSection(0.25, (xi) => Math.min(0.012, 0.15 * Math.sqrt(xi)))
    const fit = (type, diameter) => resolveEdges({ le: { type, diameter }, te: { stock: 'custom', width: 0.015 } }, section, [0]).le
    expect(fit('rod', 0.003).fits).toBe(true)
    const big = fit('rod', 0.008)
    expect(big.fits).toBe(false)
    expect(big.shortfall).toBeGreaterThan(0.0015)
    expect(big.roundFits).toBeLessThanOrEqual(0.006)
    expect(fit('rod', big.roundFits).fits).toBe(true)
    // Its centre line is where the ribs stop
    expect(big.width).toBeCloseTo(0.004, 9)
    // A symmetrical section holds it on the chord line
    expect(roundFitAt(0.004, section()).centre).toBeCloseTo(0, 9)
  })

  it('notches each rib for a carbon rod and lists it by diameter', () => {
    const res = build((st) => {
      st.le.type = 'rod'
      st.le.diameter = 0.003
    })
    expect(res.a.edges.le.round.diameter).toBe(0.003)
    expect(res.a.edges.le.fits).toBe(true)
    expect(res.a.structure.le.width).toBeCloseTo(0.0015, 9)
    for (const r of ribs(res)) {
      const b = bounds(r.outline)
      // Ribs stop at the rod's centre line; the notch reaches back to its rear face
      expect(b.x0).toBeGreaterThanOrEqual(0.0015 - 1e-6)
      expect(Math.min(...r.outline.filter(([u]) => u > 0.0025 && u < 0.0035).map(([u]) => u))).toBeLessThan(0.0032)
      expect(r.notes.some((n) => n.includes('rod'))).toBe(false)
      expect(selfIntersects(r.outline)).toBe(false)
    }
    const le = res.cutList.filter((c) => c.edge === 'le')
    expect(le[0].item).toMatch(/carbon rod, 3 mm/)
    expect(le[0].material).toBe('carbon-rod')
    expect(le[0].note).toMatch(/^Buy \d+ × 1000 mm length/)
    expect(cutListCsv(res.parts, res.cutList)).toMatch(/Carbon rod \(pultruded\),3 diameter/)
    // Weighed as a round section: about 11 g/m for 3 mm carbon
    const rod = build((st) => {
      st.le.type = 'rod'
      st.le.diameter = 0.003
    })
    const none = build((st) => {
      st.le.type = 'none'
      st.covering.type = 'dbox'
    })
    const perM = (Math.PI / 4) * 0.003 ** 2 * 1550
    const length = le.reduce((s, c) => s + c.length * c.qty, 0)
    expect(rod.weight.by.strip - none.weight.by.strip).toBeCloseTo(perM * length, 4)
    // In 3D it's a circle at the nose
    const s = res.a.rootS
    const ring = leSection(res.a, res.a.structure, s)
    const xs = ring.map(([x]) => x)
    expect(Math.min(...xs)).toBeCloseTo(res.a.section(s).xl, 6)
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(0.003, 6)
    expect(sectionIn3d(res.a, res.a.structure, res.parts, s).pieces.some((p) => p.kind === 'le')).toBe(true)
  })

  it('warns when a dowel stands proud of the section, and names the largest that fits', () => {
    const { a } = build(
      (st) => {
        st.le.type = 'dowel'
        st.le.diameter = 0.01
      },
      // Thinning to 7% at the tip
      (input) => (input.panels = input.panels.map((p) => ({ ...p, thickness: 0.07 }))),
    )
    expect(a.edges.le.fits).toBe(false)
    const w = a.warnings.find((x) => x.id === 'le-round')
    expect(w?.message).toMatch(/^The 10 mm hardwood dowel leading edge stands about [\d.]+ mm proud of the section at the tip rib/)
    expect(w.message).toMatch(/Use a [\d.]+ mm dowel \(the largest that fits\)/)
    // And drawn: the dowel standing proud, in red
    expect(a.edges.le.drawing.short.length).toBeGreaterThan(0)
  })

  it('runs the ribs to the nose with a sheeted nose, and has no leading edge stock', () => {
    const res = build((st) => {
      st.le.type = 'none'
      st.covering.type = 'dbox'
    })
    expect(res.a.structure.le.width).toBe(0)
    expect(res.cutList.some((c) => c.edge === 'le')).toBe(false)
    // As far forward as the sheeting each side leaves room for
    for (const r of ribs(res)) {
      expect(bounds(r.outline).x0).toBeLessThan(0.003)
      expect(selfIntersects(r.outline)).toBe(false)
    }
    expect(res.a.warnings.some((w) => w.id === 'le-none-open')).toBe(false)
    expect(sectionIn3d(res.a, res.a.structure, res.parts, res.a.rootS).pieces.some((p) => p.kind === 'le')).toBe(false)
    // An open wing has nothing to form the nose
    const open = build((st) => {
      st.le.type = 'none'
      st.covering.type = 'open'
    })
    expect(open.a.warnings.some((w) => w.id === 'le-none-open')).toBe(true)
  })

  it('keeps older saves on balsa stock', () => {
    const old = defaultState()
    old.input.structure.le = { stock: 'L340', width: 0.0125, material: 'balsa-hard' }
    const m = migrate(JSON.parse(JSON.stringify(old)))
    expect(m.input.structure.le.type).toBe('balsa')
    expect(m.input.structure.le.stock).toBe('L340')
  })
})
