// Picking a part in the 3D view: every solid that stands for a part names one that exists, a
// sheet or foam core that runs over several parts gives the one under the click, and every
// part the 3D view draws can be reached from it.
import { describe, it, expect } from 'vitest'
import { defaultState } from '../src/lib/projects.js'
import { resolveAirfoil, airfoilPerformance } from '../src/lib/airfoils.js'
import { wingGeometry } from '../src/lib/calc.js'
import { wingSampler, projectedSampler, normalisePanels } from '../src/lib/wing.js'
import { analyseStructure, defaultStructure } from '../src/lib/structure.js'
import { buildParts } from '../src/lib/ribs.js'
import { newSurface, defaultControls } from '../src/lib/controlSurfaces.js'
import { wing3d, worldPoint, partFor, spanOf } from '../src/lib/wing3d.js'

const aileron = newSurface('aileron', 1, 0.3, 0.55, 1)

function build(edit = () => {}, wingEdit = () => {}) {
  const s = defaultState()
  s.input.rootChord = 0.3
  s.input.mass = 2
  s.input.panels = normalisePanels([
    { id: 1, length: 0.6, tipChord: 0.24, dihedral: 3 },
    { id: 2, length: 0.3, tipChord: 0.16, dihedral: 8 },
  ])
  wingEdit(s.input)
  const st = defaultStructure()
  st.le.stock = 'custom'
  st.te.stock = 'custom'
  edit(st)
  const controls = { ...defaultControls(), surfaces: [aileron], bays: [] }
  const airfoil = resolveAirfoil(s.airfoil)
  const g = wingGeometry({ ...s.input, mode: 'panels' })
  const planform = projectedSampler(wingSampler(s.input, airfoil.params.thickness))
  const perf = airfoilPerformance(airfoil, { mass: s.input.mass, area: g.projectedArea, chord: g.mac, wing: { planform, span: g.span, sweepCos: 1 } })
  const a = analyseStructure({ wing: s.input, airfoil, structure: st, mass: s.input.mass, spanwise: perf.spanwise, controls })
  const { parts, stock } = buildParts(a, a.structure)
  return { a, st: a.structure, parts, stock, all: [...parts, ...stock], w: wing3d(a, a.structure, parts) }
}

const builtUp = (st) => {
  st.covering.type = 'sheeted'
  st.covering.sheetThickness = 0.0015
  st.gussets.le = true
  st.gussets.te = true
  st.gussets.where = 'all'
  st.gussets.layer = 'both'
}

// The ids every pickable solid can reach: its own, or for a sheet or core every part in its
// groups on its surface
function reachable(parts, solids) {
  const out = new Set()
  for (const s of solids) {
    if (!s.pick) continue
    if (s.pick.groups) {
      for (const p of parts) if (s.pick.groups.includes(p.group) && (!s.pick.surface || !p.surface || p.surface === s.pick.surface)) out.add(p.id)
    } else {
      // In this half, and in the mirrored one
      for (const mirrored of [false, true]) {
        const id = partFor(parts, s.pick, 0, { mirrored })
        if (id) out.add(id)
      }
    }
  }
  return out
}

describe('picking a part in the 3D view', () => {
  it('names a part or a piece of stock for every solid, so anything can be picked', () => {
    const { a, all, w } = build((st) => {
      builtUp(st)
      st.stringers = [{ id: 1, position: 0.5, surface: 'both', width: 0.003, height: 0.003, material: 'balsa-hard' }]
    })
    expect(w.solids.length).toBeGreaterThan(20)
    for (const s of w.solids) {
      expect(s.pick, s.kind).toBeTruthy()
      for (const at of [a.rootS + 0.01, (a.rootS + a.tipS) / 2, a.tipS - 0.01]) expect(partFor(all, s.pick, at), `${s.kind} ${JSON.stringify(s.pick)}`).not.toBeNull()
    }
  })

  it('lists the strip stock as pieces: its section as the outline, its length as the thickness', () => {
    const { a, stock } = build(builtUp)
    const spar = stock.filter((p) => p.stock === 'spar')
    expect(spar.length).toBeGreaterThanOrEqual(2) // a line per panel
    for (const p of stock) {
      expect(p.group).toBe('stock')
      expect(p.thickness).toBeGreaterThan(0)
      expect(p.outline.length).toBeGreaterThanOrEqual(3)
    }
    // The spar's two panels are picked by where along the span the click is
    const [p1, p2] = spar
    expect(partFor(stock, { stock: 'spar' }, (p1.span[0] + p1.span[1]) / 2)).toBe(p1.id)
    expect(partFor(stock, { stock: 'spar' }, (p2.span[0] + p2.span[1]) / 2)).toBe(p2.id)
    expect(a.tipS).toBeGreaterThan(p1.span[1])
  })

  it('reaches every part the 3D view draws: ribs, gussets, webs, braces, servo plates, sheeting, tabs and tip', () => {
    // With a rounded tip, for its block
    const { parts, w } = build(builtUp, (input) => (input.tip = { extension: 0.04, peak: 0.4 }))
    const got = reachable(parts, w.solids)
    for (const r of w.ribs) got.add(r.id)
    // The hatch is cut from the sheeting, not drawn separately
    const drawn = parts.filter((p) => !p.id.endsWith('-H'))
    const missing = drawn.filter((p) => !got.has(p.id)).map((p) => p.id)
    expect(missing).toEqual([])
    expect(new Set(parts.map((p) => p.group))).toEqual(new Set(['ribs', 'surfaces', 'hinges', 'servos', 'gussets', 'braces', 'webs', 'sheeting', 'tip']))
  })

  it('gives each gusset the group it is cut in', () => {
    const { parts, w } = build(builtUp)
    for (const g of w.solids.filter((s) => s.kind === 'gusset')) {
      const id = partFor(parts, g.pick, 0)
      const part = parts.find((p) => p.id === id)
      expect(part.group).toBe('gussets')
      expect(part.notes[0].startsWith(g.edge === 'le' ? 'Leading' : 'Trailing')).toBe(true)
    }
  })

  it('takes the sheet under the click: the panel and surface there', () => {
    const { a, parts, w } = build(builtUp)
    const sheets = w.solids.filter((s) => s.kind === 'sheet' && s.pick?.groups)
    expect(sheets).toHaveLength(2)
    for (const p of parts.filter((q) => q.group === 'sheeting' && q.span)) {
      const mid = (p.span[0] + p.span[1]) / 2
      expect(partFor(parts, { groups: ['sheeting', 'skins'], surface: p.surface }, mid)).toBe(p.id)
      // and found from a world point on that sheet
      const sec = a.section(mid)
      const pt = worldPoint(a, mid, sec.xl + sec.c * 0.4, 0)
      expect(partFor(parts, { groups: ['sheeting', 'skins'], surface: p.surface }, spanOf(a, pt))).toBe(p.id)
    }
  })

  it('finds the span station of a world point, across a dihedral break', () => {
    const { a } = build(builtUp)
    for (const s of [a.rootS + 0.01, 0.3, 0.59, 0.61, 0.85]) {
      const sec = a.section(s)
      for (const f of [0.1, 0.5, 0.9]) expect(spanOf(a, worldPoint(a, s, sec.xl + f * sec.c, 0.01))).toBeCloseTo(s, 5)
    }
  })

  it('picks a foam wing\'s core as its nearer hot-wire template, and a skin by panel and surface', () => {
    const { a, parts, w } = build((st) => (st.construction = 'foam'))
    const core = w.solids.find((s) => s.kind === 'core')
    expect(core.pick).toEqual({ groups: ['templates'] })
    const templates = parts.filter((p) => p.group === 'templates')
    expect(templates.length).toBeGreaterThan(1)
    for (const t of templates) expect(partFor(parts, core.pick, t.s + (t.end === 'inner' ? 0.01 : -0.01))).toBe(t.id)
    for (const k of parts.filter((p) => p.group === 'skins')) expect(partFor(parts, { groups: ['sheeting', 'skins'], surface: k.surface }, (k.span[0] + k.span[1]) / 2)).toBe(k.id)
    expect(a.cores.length).toBeGreaterThan(1)
  })
})
