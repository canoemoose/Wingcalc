// Control surfaces built into the wing: ribs split at the hinge, the surfaces' own ribs,
// hinge spars and tabs, and how they reach the cut list, DXF, 3D and thumbnails.
import { describe, it, expect } from 'vitest'
import { defaultState } from '../src/lib/projects.js'
import { resolveAirfoil, airfoilPerformance } from '../src/lib/airfoils.js'
import { wingGeometry } from '../src/lib/calc.js'
import { wingSampler, projectedSampler, normalisePanels } from '../src/lib/wing.js'
import { analyseStructure, defaultStructure } from '../src/lib/structure.js'
import { buildParts, bounds, polygonArea } from '../src/lib/ribs.js'
import { partsDxf, planDxf, parseDxf, cutListCsv, defaultExportOptions } from '../src/lib/dxf.js'
import { wing3d, sectionAt } from '../src/lib/wing3d.js'
import { planThumb, isoThumb } from '../src/lib/thumbnails.js'
import { bevelAngle, newSurface, defaultControls } from '../src/lib/controlSurfaces.js'
import { gussetSides } from '../src/lib/ribs.js'

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

// The default wing (one 0.7 m panel, 250 to 180 mm chord) with an aileron on the outer part
// and a flap inboard
const PANEL = 1
const aileron = { ...newSurface('aileron', PANEL, 0.35, 0.65, 1) }
const flap = { ...newSurface('flap', PANEL, 0.05, 0.3, 2) }

function build({ surfaces = [aileron, flap], edit = () => {}, wingEdit = () => {} } = {}) {
  const s = defaultState()
  wingEdit(s.input)
  const st = defaultStructure()
  st.le.stock = 'custom'
  st.te.stock = 'custom'
  edit(st)
  // Servo bays are off here: they have their own tests (servoBays.test.js)
  const controls = { ...defaultControls(), surfaces, bays: surfaces.map((x) => ({ surface: x.id, enabled: false })) }
  const airfoil = resolveAirfoil(s.airfoil)
  const g = wingGeometry({ ...s.input, mode: 'panels' })
  const planform = projectedSampler(wingSampler(s.input, airfoil.params.thickness))
  const perf = airfoilPerformance(airfoil, { mass: s.input.mass, area: g.projectedArea, chord: g.mac, wing: { planform, span: g.span, sweepCos: 1 } })
  const a = analyseStructure({ wing: s.input, airfoil, structure: st, mass: s.input.mass, spanwise: perf.spanwise, controls })
  return { a, st: a.structure, input: s.input, controls, ...buildParts(a, a.structure) }
}

describe('built-up control surfaces', () => {
  it('splits the ribs between at the hinge: the fixed part stops at its hinge spar', () => {
    const res = build()
    const sf = res.a.surfaces.find((r) => r.name === 'A1')
    const fixed = res.parts.filter((p) => p.group === 'ribs' && p.split)
    expect(fixed.length).toBeGreaterThan(2)
    for (const p of fixed) {
      // Streamwise, so the rib's u is x from the leading edge
      const sec = res.a.section(p.s)
      const surf = res.a.surfaces.find((r) => p.s > r.s0 && p.s < r.s1)
      const end = surf.faces.fixedFront(p.s) - sec.xl
      expect(bounds(p.outline).x1).toBeCloseTo(end, 4)
    }
    // Full ribs at the surface's ends still reach the trailing edge stock
    const endRib = res.parts.find((p) => p.group === 'ribs' && Math.abs(p.s - sf.s0) < 1e-9)
    expect(endRib.split).toBe(false)
    expect(bounds(endRib.outline).x1).toBeCloseTo(res.a.section(sf.s0).c - res.st.te.width, 4)
  })

  it('gives each surface its own ribs, from its hinge spar to the trailing edge', () => {
    const res = build()
    const sf = res.a.surfaces.find((r) => r.name === 'A1')
    const own = res.parts.filter((p) => p.group === 'surfaces' && p.surface === sf.id)
    const inside = res.parts.filter((p) => p.group === 'ribs' && p.split && p.s > sf.s0 && p.s < sf.s1)
    // An end rib each end, and one behind every split rib
    expect(own).toHaveLength(inside.length + 2)
    expect(own[0].name).toBe('A1-1')
    expect(own[0].s).toBeCloseTo(sf.endRibs[0], 9)
    expect(own.at(-1).s).toBeCloseTo(sf.endRibs[1], 9)
    // A gap clear of the wing's end ribs: rib face to rib face
    expect(own[0].s - own[0].thickness / 2 - (sf.s0 + res.st.ribs.thickness / 2)).toBeCloseTo(sf.gap, 9)
    for (const p of own) {
      const sec = res.a.section(p.s)
      const b = bounds(p.outline)
      expect(b.x0).toBeCloseTo(sf.faces.movingRear(p.s) - sec.xl, 4)
      expect(b.x1).toBeCloseTo(sec.c - res.st.te.width, 4)
      expect(p.label.text).toBe(p.name)
    }
  })

  it('makes closed, simple outlines either side of the hinge, for every spar and rib option', () => {
    const variants = [
      build(),
      build({
        edit: (st) => {
          st.ribs.orientation = 'perpendicular'
          st.ribs.jigTabs = true
          st.ribs.lightening = true
          st.gussets.le = st.gussets.te = true
          st.gussets.where = 'all'
        },
        wingEdit: (input) => {
          input.panels = normalisePanels([{ id: 1, length: 0.7, tipChord: 0.16, sweep: 0.06, dihedral: 4, washout: 2 }])
        },
      }),
      build({
        edit: (st) => {
          st.spar.type = 'tube'
          st.covering.type = 'sheeted'
          st.ribs.lightening = true
        },
      }),
      build({ surfaces: [{ ...aileron, hingeIn: 0.68, hingeOut: 0.8, up: 25, down: 25 }] }),
    ]
    for (const res of variants) {
      expect(res.a.surfaces.every((r) => r.ok)).toBe(true)
      expect(res.skipped).toEqual([])
      for (const p of res.parts.filter((q) => q.group === 'ribs' || q.group === 'surfaces')) {
        expect(p.outline.length, p.name).toBeGreaterThan(3)
        expect(p.outline.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)), p.name).toBe(true)
        expect(Math.abs(polygonArea(p.outline)), p.name).toBeGreaterThan(1e-5)
        expect(selfIntersects(p.outline), p.name).toBe(false)
        for (const h of p.holes) for (const pt of h) expect(inside(p.outline, pt), `${p.name} hole`).toBe(true)
      }
    }
  })

  it('lists both hinge spars and the tabs, and weighs them', () => {
    const plain = build({ surfaces: [] })
    const res = build()
    const sf = res.a.surfaces.find((r) => r.name === 'A1')
    const fixed = res.cutList.find((c) => c.item === 'Hinge spar, fixed side, Aileron A1')
    const moving = res.cutList.find((c) => c.item === 'Hinge spar, moving side, Aileron A1')
    expect(fixed.size[0]).toBe(res.st.hinges.fixedWidth)
    expect(moving.size[0]).toBe(res.st.hinges.movingWidth)
    expect(fixed.length).toBeCloseTo((sf.s1 - sf.s0 - res.st.ribs.thickness) * Math.sqrt(1 + sf.slope ** 2), 9)
    expect(moving.note).toMatch(/Bevel the front to a point/)
    expect(fixed.qty).toBe(2)
    const tabs = res.parts.find((p) => p.group === 'hinges')
    const count = res.a.surfaces.reduce((n, r) => n + r.tabs.length, 0)
    expect(tabs.qty).toBe(count * 2)
    expect(tabs.material).toBe('mylar')
    const b = bounds(tabs.outline)
    expect(b.w).toBeCloseTo(res.st.hinges.tabLength, 9)
    expect(b.h).toBeCloseTo(res.st.hinges.tabWidth, 9)
    // The surfaces' ribs, the hinge spars and tabs are in the weight
    expect(res.weight.by.surfaces).toBeGreaterThan(0)
    expect(res.weight.by.hinges).toBeGreaterThan(0)
    // Heavier by the hinge spars and tabs (with 10% for glue), plus a little for the extra ribs
    // at the surfaces' ends: the ribs between are split, not added to
    const rho = (c) => ({ 'balsa-medium': 160 })[c.material]
    const spars = res.cutList.filter((c) => c.item.startsWith('Hinge spar')).reduce((m, c) => m + c.size[0] * c.size[1] * c.length * c.qty * rho(c), 0)
    const extra = (spars + res.weight.by.hinges) * 1.1
    expect(res.weight.total - plain.weight.total).toBeGreaterThan(extra)
    expect(res.weight.total - plain.weight.total).toBeLessThan(extra * 1.5)
    // The CSV names them
    const csv = cutListCsv(res.parts, res.cutList)
    expect(csv).toContain('Hinge spar, moving side, Aileron A1')
    expect(csv).toContain('A1-1')
    expect(csv).toContain('Mylar')
  })

  it('leaves the ribs whole where a surface isn’t built', () => {
    const aft = build({ surfaces: [{ ...aileron, hingeIn: 0.93, hingeOut: 0.93 }] })
    expect(aft.parts.some((p) => p.split || p.group === 'surfaces' || p.group === 'hinges')).toBe(false)
  })

  it('puts no trailing-edge gussets on ribs cut at a hinge', () => {
    const res = build({ edit: (st) => Object.assign(st.gussets, { te: true, where: 'all', layer: 'top', teLayer: 'top' }) })
    const te = res.parts.filter((p) => p.group === 'gussets' && p.notes[0].startsWith('Trailing')).reduce((n, p) => n + p.qty, 0)
    const whole = res.parts.filter((p) => p.group === 'ribs' && !p.split)
    expect(te).toBe(whole.reduce((n, p) => n + p.qty * gussetSides(p, res.st.gussets, res.st.ribs.rootJoint).length, 0))
  })

  it('exports the surfaces’ parts and hinges to the DXF, labelled, and draws them on the plan', () => {
    const res = build()
    const opts = defaultExportOptions()
    const [file] = partsDxf(res.parts, opts, 'test')
    const d = parseDxf(file.text)
    const cuts = d.polylines.filter((p) => p.layer === 'CUT')
    const pieces = res.parts.filter((p) => opts.parts[p.group] !== false).reduce((n, p) => n + p.qty, 0)
    expect(cuts.length).toBeGreaterThanOrEqual(pieces)
    // Leaving the surfaces out drops their ribs and the tabs
    const without = parseDxf(partsDxf(res.parts, { ...opts, parts: { ...opts.parts, surfaces: false, hinges: false } }, 'test')[0].text)
    const dropped = res.parts.filter((p) => p.group === 'surfaces' || p.group === 'hinges').reduce((n, p) => n + p.qty, 0)
    expect(cuts.length - without.polylines.filter((p) => p.layer === 'CUT').length).toBe(dropped)
    const plan = parseDxf(planDxf(res.a, res.st, res.parts, { ...opts, handedness: 'right' }, 'test').text)
    expect(plan.layers).toContain('HINGE')
    const hinge = plan.polylines.filter((p) => p.layer === 'HINGE')
    // Four spar faces, two end lines and a mark per tab, per surface
    const tabs = res.a.surfaces.reduce((n, r) => n + r.tabs.length, 0)
    expect(hinge.length).toBe(res.a.surfaces.length * 6 + tabs)
    // Every one of the surfaces' ribs is on the plan with the wing's
    const ribs = plan.polylines.filter((p) => p.layer === 'RIBS')
    expect(ribs.length).toBe(res.parts.filter((p) => p.group === 'ribs' || p.group === 'surfaces').length)
  })

  it('builds the surfaces in 3D as their own layer, and draws them in the thumbnails', () => {
    const res = build()
    const m = wing3d(res.a, res.st, res.parts)
    expect(m.ribs.filter((r) => r.surface)).toHaveLength(res.parts.filter((p) => p.group === 'surfaces').length)
    const kinds = new Set(m.solids.map((x) => x.kind))
    for (const k of ['hinge', 'hingeMoving', 'teMoving', 'te']) expect(kinds.has(k), k).toBe(true)
    for (const sl of m.solids) {
      expect(sl.positions.every(Number.isFinite), sl.kind).toBe(true)
      expect(sl.indices.length % 3).toBe(0)
    }
    // A cut through the aileron shows both hinge spars
    const sf = res.a.surfaces.find((r) => r.name === 'A1')
    const cut = sectionAt(res.a, res.st, res.parts, (sf.moving[0] + sf.moving[1]) / 2 + 0.003)
    expect(cut.pieces.filter((p) => p.kind === 'hinge' || p.kind === 'hingeMoving')).toHaveLength(2)
    const iso = isoThumb(res.a, res.st, res.parts)
    const plain = isoThumb(build({ surfaces: [] }).a, res.st, build({ surfaces: [] }).parts)
    expect(iso.lines.filter((l) => l.kind === 'rib').length).toBeGreaterThan(plain.lines.filter((l) => l.kind === 'rib').length)
    expect(planThumb(res.a, res.st, res.parts).lines.length).toBeGreaterThan(0)
  })
})
