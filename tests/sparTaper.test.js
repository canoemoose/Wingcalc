import { describe, it, expect } from 'vitest'
import { defaultState, fillDefaults } from '../src/lib/projects.js'
import { resolveAirfoil, airfoilPerformance } from '../src/lib/airfoils.js'
import { wingGeometry } from '../src/lib/calc.js'
import { wingSampler, projectedSampler } from '../src/lib/wing.js'
import { analyseStructure, defaultStructure, solidDepthFor, solidDepthAt, thinRib } from '../src/lib/structure.js'
import { buildParts, bounds } from '../src/lib/ribs.js'
import { wing3d, wingPieces, sparBoxes } from '../src/lib/wing3d.js'

// A deep solid spar (16 mm) in the default wing, which thins towards the tip
function build(edit = () => {}) {
  const s = defaultState()
  const st = defaultStructure()
  st.spar.type = 'solid'
  st.spar.solidDepth = 0.016
  st.spar.solidWidth = 0.006
  edit(st)
  const airfoil = resolveAirfoil(s.airfoil)
  const g = wingGeometry({ ...s.input, mode: 'panels' })
  const planform = projectedSampler(wingSampler(s.input, airfoil.params.thickness))
  const perf = airfoilPerformance(airfoil, { mass: s.input.mass, area: g.projectedArea, chord: g.mac, wing: { planform, span: g.span, sweepCos: 1 } })
  const a = analyseStructure({ wing: s.input, airfoil, structure: st, mass: s.input.mass, spanwise: perf.spanwise })
  return { a, ...buildParts(a, a.structure) }
}
const ribPart = (parts, name) => parts.find((p) => p.id === name)

describe('a solid spar too deep for thin ribs', () => {
  it('defaults to a 4 mm margin and keeping the rib round it, and migrates older saves', () => {
    const sp = defaultStructure().spar
    expect(sp.ribMargin).toBe(0.004)
    expect(sp.thinRibs).toBe('margin')
    expect(fillDefaults(defaultStructure(), { spar: { type: 'solid' } }).spar.ribFits).toEqual({})
    // 20 mm of room: a 16 mm spar leaves 2 mm each side, so it tapers to 12 mm; split takes 16
    const s = { ...sp, solidDepth: 0.016 }
    expect(thinRib(s, 0.02)).toBe(true)
    expect(solidDepthFor(s, 0.02, 'margin')).toBeCloseTo(0.012, 9)
    expect(solidDepthFor(s, 0.02, 'split')).toBeCloseTo(0.016, 9)
    expect(solidDepthFor({ ...s, solidMount: 'top' }, 0.018, 'margin')).toBeCloseTo(0.014, 9)
  })

  it('tapers the spar at the thin ribs, leaving the margin of rib above and below its slot', () => {
    const { a, parts } = build()
    const taper = a.structure.spar.taper
    const thin = taper.filter((t) => t.thin)
    expect(thin.length).toBeGreaterThan(2)
    expect(taper.some((t) => !t.thin && Math.abs(t.depth - 0.016) < 1e-9)).toBe(true)
    for (const t of thin) {
      expect(t.depth).toBeCloseTo(t.inner - 0.008, 9)
      const p = ribPart(parts, t.name)
      const r = p.rib
      // The slot is the tapered depth, with about 4 mm of rib above and below it
      const slot = p.holes.find((h) => {
        const b = bounds(h)
        return b.x0 >= r.sparNotch[0] - 1e-6 && b.x1 <= r.sparNotch[1] + 1e-6
      })
      const b = bounds(slot)
      expect(b.h).toBeCloseTo(t.depth, 6)
      const i = r.surfaces.us.findIndex((u) => u >= r.sparU)
      expect(r.surfaces.upIn[i] - b.y1).toBeGreaterThan(0.0035)
      expect(b.y0 - r.surfaces.loIn[i]).toBeGreaterThan(0.0035)
      expect(p.notes.some((n) => /tapers to/.test(n))).toBe(true)
    }
    // The 3D spar is as deep as the slot at each rib
    const t = thin[1]
    const box = sparBoxes(a, a.structure, t.s)[0]
    expect(box[2][1] - box[0][1]).toBeCloseTo(t.depth, 6)
    // And the strength check takes the shallower spar
    const row = a.stations.find((r) => r.s >= t.s)
    expect(row.fits).toBe(true)
  })

  it('splits a rib at the spar on request, the spar its full depth there', () => {
    const base = build()
    const name = base.a.structure.spar.taper.filter((t) => t.thin).at(-2).name
    const { a, parts, cutList } = build((st) => (st.spar.ribFits = { [name]: 'split' }))
    const t = a.structure.spar.taper.find((x) => x.name === name)
    expect(t.fit).toBe('split')
    expect(t.depth).toBeCloseTo(Math.min(0.016, t.inner), 9)
    const front = ribPart(parts, name)
    const rear = ribPart(parts, `${name}B`)
    expect(rear.of).toBe(name)
    expect(bounds(front.outline).x1).toBeLessThanOrEqual(front.rib.sparNotch[0] + 1e-6)
    expect(bounds(rear.outline).x0).toBeGreaterThanOrEqual(front.rib.sparNotch[1] - 1e-6)
    expect(front.label.text).toBe(`${name}A`)
    // It fits by design: no "doesn't fit" note on either piece
    expect([...front.notes, ...rear.notes].some((n) => /doesn't fit/.test(n))).toBe(false)
    expect(rear.label.text).toBe(`${name}B`)
    // Only that one: its neighbours keep the margin
    expect(parts.filter((p) => p.of)).toHaveLength(1)
    // Both pieces are drawn in 3D and each is its own piece
    const w = wing3d(a, a.structure, parts)
    expect(w.ribs.some((r) => r.id === `${name}B`)).toBe(true)
    // Webs and gussets still see one rib per station: no web between the two pieces
    expect(parts.filter((p) => p.group === 'webs')).toHaveLength(0)
    expect(cutList.length).toBeGreaterThan(0)
  })

  it('splits every thin rib when that is the wing-wide choice', () => {
    const { a, parts } = build((st) => (st.spar.thinRibs = 'split'))
    const thin = a.structure.spar.taper.filter((t) => t.thin)
    expect(parts.filter((p) => p.of)).toHaveLength(thin.length)
  })

  it('exports a template for each panel along the tapered spar, which carries its weight', () => {
    const { a, parts, cutList, weight } = build()
    const sp = parts.filter((p) => p.group === 'spars')
    expect(sp).toHaveLength(1)
    const [tpl] = sp
    expect(tpl.thickness).toBeCloseTo(0.006, 9)
    const b = bounds(tpl.outline)
    expect(b.w).toBeCloseTo(a.tipS - a.rootS, 6)
    expect(b.h).toBeCloseTo(0.016, 6)
    // Its depth at the tip end is the spar's there, centred (it sits in slots)
    const atTip = tpl.outline.filter(([u]) => Math.abs(u - b.w) < 1e-9).map(([, y]) => y)
    expect(Math.max(...atTip) - Math.min(...atTip)).toBeCloseTo(solidDepthAt(a.structure.spar, a.tipS), 6)
    expect((Math.max(...atTip) + Math.min(...atTip)) / 2).toBeCloseTo(0.008, 6)
    // The stock line is cut to it, and not weighed twice
    const stock = cutList.find((c) => /^Spar, /.test(c.item))
    expect(stock.cutToParts).toBe(true)
    expect(weight.by.spars).toBeGreaterThan(0)
    // Every part, the template too, is a piece of the 3D wing
    const pieces = wingPieces(wing3d(a, a.structure, parts), parts)
    expect(pieces.some((p) => p.part === tpl.id)).toBe(true)
  })

  it('keeps the top edge straight for a spar in top notches', () => {
    const { parts } = build((st) => (st.spar.solidMount = 'top'))
    const [tpl] = parts.filter((p) => p.group === 'spars')
    const b = bounds(tpl.outline)
    const tops = tpl.outline.filter(([, y]) => y > b.h / 2).map(([, y]) => y)
    for (const y of tops) expect(y).toBeCloseTo(0.016, 9)
  })

  it("has no template where the spar fits every rib, and warns where it tapers to nothing", () => {
    const shallow = build((st) => (st.spar.solidDepth = 0.006))
    expect(shallow.parts.some((p) => p.group === 'spars')).toBe(false)
    expect(shallow.a.structure.spar.taper.every((t) => !t.thin)).toBe(true)
    const thick = build((st) => (st.spar.ribMargin = 0.012))
    expect(thick.a.warnings.find((w) => w.id === 'spar-fit')?.message).toMatch(/tapers to nothing/)
  })
})
