import { describe, it, expect } from 'vitest'
import { defaultState, migrate } from '../src/lib/projects.js'
import { resolveAirfoil, airfoilPerformance } from '../src/lib/airfoils.js'
import { wingGeometry } from '../src/lib/calc.js'
import { wingSampler, projectedSampler } from '../src/lib/wing.js'
import { analyseStructure, defaultStructure } from '../src/lib/structure.js'
import { buildParts, bounds, buildRib } from '../src/lib/ribs.js'
import { cutListCsv } from '../src/lib/dxf.js'
import { LE_STOCK, TE_STOCK, resolveEdges, lengthsToBuy, roundFitAt, migrateLeStockId, fitDrawing, profileOutline, fitOver, insetPlacement } from '../src/lib/edgeStock.js'
import { sectionAt as sectionIn3d, leSection, sheetSection as sheetSection3d } from '../src/lib/wing3d.js'

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

  it('checks the whole profile, not just the rib face, and slides a profile forward to fit', () => {
    // A blunt nose: full depth almost at once. A symmetrical (rounded) profile as tall as the
    // section at the rib face can't contain it tangent to the nose; a plain strip of the same
    // size can. Slid forward, the rounded front ahead of the nose is carved away and it fits,
    // reaching less far into the wing.
    const section = plainSection(0.25, (xi) => (xi > 0 ? 0.022 : 0))
    const sym = LE_STOCK.find((x) => x.code === 'L345')
    const strip = LE_STOCK.find((x) => x.code === 'L280')
    expect(fitOver(sym, section, [0], 'le').fits).toBe(false)
    const fit = (id) => resolveEdges({ le: { stock: id }, te: { stock: 'custom', width: 0.015 } }, section, [0]).le
    const s = fit(sym.id)
    expect(s.fits).toBe(true)
    expect(s.offset).toBeGreaterThan(0)
    expect(s.width).toBeCloseTo(sym.width - s.offset, 9)
    expect(s.stockWidth).toBe(sym.width)
    const p = fit(strip.id)
    expect(p.fits).toBe(true)
    expect(p.offset).toBe(0)
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
    expect(tall.item).toMatchObject({ kind: 'block', width: 0.01, height: 0.03 })
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
    // As far as each stock reaches into the wing: its own depth, less any it's set past the edge
    const { le, te } = res.a.edges
    expect(le.width).toBeCloseTo(0.0125 - le.offset, 6)
    expect(te.width).toBeCloseTo(0.025 - te.offset, 6)
    expect(b.x0).toBeCloseTo(le.width, 6)
    expect(b.x1).toBeCloseTo(0.25 - te.width, 6)
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
    expect(le?.message).toMatch(/^The leading edge stock \(3 × 3 mm custom block\) is too small to carve the wing's nose from/)
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
    // Trailing edge drawn forward of the trailing edge, as negative x, reaching aft of it only by
    // as much as the stock is set past it
    expect(good.te.drawing.x0).toBeLessThan(0)
    expect(good.te.drawing.x1).toBeLessThanOrEqual(good.te.offset + 1e-6)
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

describe('square trailing-edge stock', () => {
  it('is offered by hand as a bolster, and Auto never picks it', () => {
    const sq = TE_STOCK.filter((x) => x.kind === 'square')
    expect(sq.length).toBeGreaterThan(3)
    for (const x of sq) expect(x.width).toBe(x.height)
    const { a } = build()
    expect(a.edges.te.auto.kind).toBe('triangular')
    const chosen = build((st) => (st.te.stock = sq.find((x) => x.width > 0.009).id)).a
    expect(chosen.structure.te.type).toBe('square')
    expect(chosen.edges.te.item.kind).toBe('square')
  })
})

describe('edge stock drawings', () => {
  it('draws a square stock as a square however the fit tilts it', () => {
    const sq = { kind: 'strip', width: 0.01, height: 0.01 }
    // A cambered section's nose wants the stock tilted
    const sec = { c: 0.2, surf: (xi) => ({ upper: 0.02 * Math.sqrt(xi) + 0.01 * xi, lower: -0.012 * Math.sqrt(xi) + 0.01 * xi }) }
    const d = fitDrawing(sq, sec, 'le')
    const P = d.stock
    // Corners: the profile's top and bottom at the edge and at the rib face
    const n = P.length / 2 - 1
    const corners = [P[0], P[n], P[n + 1], P.at(-1)]
    const len = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1])
    expect(len(corners[0], corners[1])).toBeCloseTo(0.01, 6)
    expect(len(corners[1], corners[2])).toBeCloseTo(0.01, 6)
    expect(len(corners[0], corners[3])).toBeCloseTo(0.01, 6)
    // and square: the diagonals match
    expect(len(corners[0], corners[2])).toBeCloseTo(len(corners[1], corners[3]), 6)
  })
  it('outlines a symmetrical profile evenly about its middle', () => {
    const out = profileOutline({ kind: 'symmetrical', width: 0.01, height: 0.01 })
    const n = out.length / 2
    for (let i = 0; i < n; i++) {
      const top = out[i], bot = out[out.length - 1 - i]
      expect(top[0]).toBeCloseTo(bot[0], 9)
      expect(top[1] + bot[1]).toBeCloseTo(0.01, 9)
    }
  })
})

describe('square and rotated edge stock', () => {
  // A strongly cambered nose (its mean line climbing at about 17 degrees), 250 mm chord
  const cambered = () => {
    const c = 0.25
    const sec = { c, surf: (xi) => ({ upper: (0.06 * Math.sqrt(xi) + 0.3 * xi) * c, lower: (-0.06 * Math.sqrt(xi) + 0.3 * xi) * c }) }
    return () => sec
  }
  const sym = LE_STOCK.find((x) => x.code === 'L335')

  it('keeps square stock square: no angle, its back face square to the chord', () => {
    const f = fitOver(sym, cambered(), [0], 'le', { mode: 'square' })
    expect(f.at[0].theta).toBe(0)
    const d = fitDrawing(sym, cambered()(), 'le', { mode: 'square' })
    expect(d.angle).toBe(0)
    // The face is vertical
    expect(d.face[0][0]).toBeCloseTo(d.face[1][0], 9)
  })

  it('turns stock to the camber when that is what lets it fit at the nose', () => {
    // Too shallow to hold the climbing nose square, it fits turned nose-up
    const small = LE_STOCK.find((x) => x.code === 'L325')
    const sq = fitOver(small, cambered(), [0], 'le', { mode: 'square', d: 0 })
    const rot = fitOver(small, cambered(), [0], 'le', { mode: 'rotated', d: 0 })
    expect(sq.fits).toBe(false)
    expect(rot.at[0].theta).toBeGreaterThan(0)
    expect(rot.shortfall).toBeLessThan(sq.shortfall)
    // Stock that already fits square isn't turned: turning it would only carve more away
    const roomy = LE_STOCK.find((x) => x.kind === 'symmetrical' && fitOver(x, cambered(), [0], 'le', { mode: 'square', d: 0 }).fits)
    expect(roomy).toBeTruthy()
    expect(fitOver(roomy, cambered(), [0], 'le', { mode: 'rotated', d: 0 }).at[0].theta).toBe(0)
    // The drawing's face leans with it
    const d = fitDrawing(small, cambered()(), 'le', { mode: 'rotated' })
    expect(Math.abs(d.face[1][0] - d.face[0][0])).toBeGreaterThan(1e-4)
  })

  it('splits the section at the rib face: the carved edge ahead of it, the rib behind', () => {
    const area = (o) => Math.abs(o.reduce((t, [x1, y1], i) => { const [x2, y2] = o[(i + 1) % o.length]; return t + x1 * y2 - x2 * y1 }, 0)) / 2
    for (const mode of ['square', 'rotated']) {
      const d = fitDrawing(sym, cambered()(), 'le', { mode })
      const whole = area([...[...d.upper].reverse(), ...d.lower])
      expect(area(d.carved) + area(d.rib)).toBeCloseTo(whole, 8)
      expect(area(d.carved)).toBeGreaterThan(0)
    }
  })

  it('follows the setting on each edge', () => {
    const sq = build().a.edges
    const rot = build((st) => {
      st.le.fit = 'rotated'
      st.te.fit = 'rotated'
    }).a.edges
    expect(sq.le.mode).toBe('square')
    expect(sq.le.angle).toBe(0)
    expect(rot.le.mode).toBe('rotated')
    expect(rot.te.mode).toBe('rotated')
    expect(rot.le.drawing.carved.length).toBeGreaterThan(2)
  })
})

describe('edge stock let into the ribs', () => {
  const { a } = build((st) => {
    st.le.fit = 'inset'
    st.te.fit = 'inset'
  })
  it('lets in the leading edge only: the trailing edge stays square', () => {
    expect(a.edges.te.mode).toBe('square')
    expect(a.edges.te.drawing.inset).toBeUndefined()
  })
  for (const k of ['le']) {
    it(`places the ${k} strip at the edge, its bottom along the lower surface, the rib over it`, () => {
      const e = a.edges[k]
      expect(e.mode).toBe('inset')
      expect(['strip', 'square', 'triangular']).toContain(e.item.kind)
      const d = e.drawing
      expect(d.inset).toBe(true)
      // Right at the edge: only as far past it as covers the edge's own curve, turned
      expect(d.offset).toBeLessThan(e.item.width * 0.2)
      // Its bottom is at or below the lower surface wherever it is: the bottom corners of the
      // carved shape are on the lower surface, not above it
      const sec = a.section(e.worstS)
      const sign = k === 'le' ? 1 : -1
      const lowerAt = (x) => sec.surf(Math.min(1, Math.max(0, k === 'le' ? x / sec.c : 1 + x / sec.c))).lower
      for (const [x, z] of d.carved) expect(z).toBeGreaterThanOrEqual(lowerAt(sign * Math.abs(x)) - 1e-4)
      // The rib keeps material over its back corner when it fits
      if (d.fits) expect(d.over).toBeGreaterThanOrEqual(0.0015 - 0.0002)
      // What's carved is inside the stock as sold
      expect(d.carved.length).toBeGreaterThan(2)
    })
  }
})

describe('ribs for a leading edge let into them', () => {
  const inset = build((st) => (st.le.fit = 'inset'))
  const square = build()
  const root = (r) => r.parts.find((p) => p.group === 'ribs')

  it('run the rib forward over the strip, past where a square-cut rib stops', () => {
    const ui = Math.min(...root(inset).outline.map(([u]) => u))
    const us = Math.min(...root(square).outline.map(([u]) => u))
    expect(ui).toBeLessThan(us - 0.001)
  })

  it('notch the rib out of the strip: nothing of the rib below the strip top ahead of its back', () => {
    const { a } = inset
    const e = a.edges.le
    const sec = a.section(a.ribs[0].s)
    const P = insetPlacement(e.item, sec)
    const top = (v) => {
      // The strip's top line in the section, at v back from the nose
      const [v0, y0] = P.toV(0, P.H)
      const [v1, y1] = P.toV(P.W, P.H)
      return y0 + ((y1 - y0) * (v - v0)) / (v1 - v0)
    }
    const back = Math.min(P.toV(P.W, 0)[0], P.toV(P.W, P.H)[0])
    const ahead = root(inset).outline.filter(([u]) => u < back - 0.0005)
    expect(ahead.length).toBeGreaterThan(2)
    for (const [u, z] of ahead) expect(z).toBeGreaterThanOrEqual(top(u) - 2e-4)
  })

  it('draw the 3D leading edge as the carved strip', () => {
    const { a } = inset
    const P = leSection(a, a.structure, a.ribs[0].s)
    const xs = P.map(([x]) => x)
    const sec = a.section(a.ribs[0].s)
    // It starts at the nose and reaches back about the strip's depth
    expect(Math.min(...xs)).toBeCloseTo(sec.xl, 3)
    expect(Math.max(...xs) - sec.xl).toBeGreaterThan(a.edges.le.item.width * 0.8)
    // The same number of points at every station, so it lofts along the span
    const counts = new Set([0, 0.25, 0.5, 0.75, 1].map((f) => leSection(a, a.structure, a.rootS + (a.tipS - a.rootS) * f * 0.98)?.length))
    expect(counts.size).toBe(1)
  })
})

describe('joints round an inset leading edge', () => {
  it('runs the rib forward over the strip until it feathers out', () => {
    const { parts } = build((st) => (st.le.fit = 'inset'))
    const o = parts.find((p) => p.group === 'ribs').outline
    const u0 = Math.min(...o.map(([u]) => u))
    const front = o.filter(([u]) => u < u0 + 1e-6).map(([, z]) => z)
    // Its front edge, over the strip, is only about half a millimetre tall
    expect(Math.max(...front) - Math.min(...front)).toBeLessThan(0.001)
  })

  it('steps the rib top square where the cap strips start', () => {
    const { a, parts } = build((st) => {
      st.le.fit = 'inset'
      st.covering.type = 'open'
      st.covering.capStrips = true
      // Clear of the strip's back, so the step stands on its own
      st.covering.capStripStart = 0.1
    })
    const o = parts.find((p) => p.group === 'ribs').outline
    const t = a.structure.covering.capStripThickness
    // Somewhere along the top two points sit at the same place, one cap strip apart in height
    const steps = o.filter((p, i) => {
      const q = o[(i + 1) % o.length]
      return Math.abs(q[0] - p[0]) < 1e-5 && Math.abs(Math.abs(q[1] - p[1]) - t) < 2e-4
    })
    expect(steps.length).toBeGreaterThan(0)
  })

  it('starts the bottom cap strips at the back of the strip, where its bottom stops being the surface', () => {
    const { a } = build((st) => {
      st.le.fit = 'inset'
      st.covering.type = 'open'
      st.covering.capStrips = true
    })
    const rib = a.ribs[0]
    const rb = buildRib(a, a.structure, rib)
    const sec = a.section(rib.s)
    const P = insetPlacement(a.edges.le.item, sec)
    expect(rb.capStripFrom.bottom).toBeCloseTo(P.toV(P.W, 0)[0], 3)
  })

  it('brings a D-box forward over the strip on top, and to its back underneath', () => {
    const { a } = build((st) => {
      st.le.fit = 'inset'
      st.covering.type = 'dbox'
    })
    const sec = a.section(a.rootS)
    const top = sheetSection3d(a, a.structure, a.rootS, 'upper')
    const bottom = sheetSection3d(a, a.structure, a.rootS, 'lower')
    const start = (P) => Math.min(...P.map(([x]) => x)) - sec.xl
    const P = insetPlacement(a.edges.le.item, sec)
    expect(start(top)).toBeLessThan(P.toV(P.W, P.H)[0] - 0.001)
    expect(start(bottom)).toBeCloseTo(P.toV(P.W, 0)[0], 4)
  })
})

describe('a let-in strip either way up', () => {
  const inset = (lay, stock = 'L263') => build((st) => {
    st.le.fit = 'inset'
    st.le.stock = stock
    st.le.lay = lay
  }).a.edges.le
  it('stands it on edge or lays it flat as asked, its longer side up or along the chord', () => {
    const edge = inset('edge')
    const flat = inset('flat')
    expect(edge.item.laid).toBe('edge')
    expect(edge.item.height).toBeGreaterThan(edge.item.width)
    expect(flat.item.laid).toBe('flat')
    expect(flat.item.width).toBeGreaterThan(flat.item.height)
  })
  it('picks the better way when left to it, and lists it in the cut list as sold', () => {
    const best = inset('best')
    expect(['edge', 'flat']).toContain(best.item.laid)
    const { cutList } = build((st) => {
      st.le.fit = 'inset'
      st.le.stock = 'L263'
      st.le.lay = 'flat'
    })
    const le = cutList.find((c) => c.edge === 'le')
    expect(le.size).toEqual([0.0065, 0.025])
    expect(le.item).toMatch(/laid flat/)
  })
})
