// Pieces of the wing in the 3D view: every solid is a named piece that can be selected and
// shown on its own, each piece cut from sheet knows its part, every part drawn in the wing is
// reached through its pieces, and the strip stock, servos and cores are pieces too.
import { describe, it, expect } from 'vitest'
import { defaultState } from '../src/lib/projects.js'
import { resolveAirfoil, airfoilPerformance } from '../src/lib/airfoils.js'
import { wingGeometry } from '../src/lib/calc.js'
import { wingSampler, projectedSampler, normalisePanels } from '../src/lib/wing.js'
import { analyseStructure, defaultStructure } from '../src/lib/structure.js'
import { buildParts } from '../src/lib/ribs.js'
import { newSurface, defaultControls } from '../src/lib/controlSurfaces.js'
import { wing3d, worldPoint, partFor, spanOf, panelRuns, wingPieces, pieceOutline } from '../src/lib/wing3d.js'
import { pieceDrawing } from '../src/lib/pieceDrawing.js'
import { bayLinkages } from '../src/lib/bayLinkage.js'
import { bounds } from '../src/lib/ribs.js'

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
  const { parts, cutList } = buildParts(a, a.structure)
  // With each bay's arm, horn and pushrod, as the app builds it
  const w = wing3d(a, a.structure, parts, bayLinkages(a, controls))
  return { a, st: a.structure, parts, cutList, w, pieces: wingPieces(w, parts) }
}

const builtUp = (st) => {
  st.covering.type = 'sheeted'
  st.covering.sheetThickness = 0.0015
  st.gussets.le = true
  st.gussets.te = true
  st.gussets.where = 'all'
  st.gussets.layer = 'both'
  st.stringers = [{ id: 1, position: 0.5, surface: 'both', width: 0.003, height: 0.003, material: 'balsa-hard' }]
}

describe('the pieces of the wing', () => {
  it('makes every solid a named piece, every piece selectable on its own', () => {
    const { w, pieces } = build(builtUp)
    expect(w.solids.length).toBeGreaterThan(20)
    for (const s of w.solids) {
      expect(s.piece?.id, s.kind).toBeTruthy()
      expect(s.piece.name, s.kind).toBeTruthy()
    }
    // Every solid in exactly one piece, every rib and cap strip a piece of its own
    const covered = pieces.flatMap((p) => p.solids)
    expect(new Set(covered).size).toBe(w.solids.length)
    expect(covered).toHaveLength(w.solids.length)
    expect(pieces.filter((p) => p.rib)).toHaveLength(w.ribs.length)
    const ids = pieces.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('names the strip stock, which is cut from no sheet', () => {
    const { pieces } = build(builtUp)
    const names = pieces.map((p) => p.name)
    for (const n of ['Spar cap, top', 'Spar cap, bottom', 'Leading edge', 'Stringer at 50% chord, top', 'Stringer at 50% chord, bottom']) expect(names).toContain(n)
    // The servo's linkage: bought, so pieces with no part
    for (const n of ['Servo arm, SB1', 'Control horn, SB1', 'Pushrod, SB1']) expect(names.some((x) => x.startsWith(n)), n).toBe(true)
    expect(names.some((n) => n.startsWith('Hinge spar, fixed side, '))).toBe(true)
    expect(names.some((n) => n.startsWith('Trailing edge'))).toBe(true)
    for (const p of pieces.filter((x) => ['spar', 'le', 'te', 'stringer', 'hinge'].includes(x.kind))) {
      expect(p.part, p.name).toBeNull()
      expect(p.material, p.name).toBeTruthy()
    }
  })

  it('gives every piece cut from sheet its part, and reaches every part drawn in the wing', () => {
    const { parts, pieces, w } = build(builtUp, (input) => (input.tip = { extension: 0.04, peak: 0.4 }))
    const got = new Set(pieces.map((p) => p.part).filter(Boolean))
    // The centre rib's inboard gussets are drawn with the other half, mirrored
    for (const s of w.solids.filter((x) => x.pick?.mirrorMember)) got.add(partFor(parts, s.pick, 0, { mirrored: true }))
    // The hatch is cut from the sheeting, not drawn separately
    const missing = parts.filter((p) => !p.id.endsWith('-H') && !got.has(p.id)).map((p) => p.id)
    expect(missing).toEqual([])
    for (const p of pieces.filter((x) => x.part)) expect(parts.some((q) => q.id === p.part), p.name).toBe(true)
  })

  it('gives each gusset the group it is cut in, and names it by its rib, edge and side', () => {
    const { parts, pieces } = build(builtUp)
    const gussets = pieces.filter((p) => p.kind === 'gusset')
    expect(gussets.length).toBeGreaterThan(4)
    for (const g of gussets) {
      const part = parts.find((p) => p.id === g.part)
      expect(part.group).toBe('gussets')
      const le = g.name.includes('leading edge')
      expect(part.notes[0].startsWith(le ? 'Leading' : 'Trailing')).toBe(true)
      expect(g.name).toMatch(/^Gusset at R\d+, (leading|trailing) edge, (in|out)board, (top|bottom)$/)
    }
  })

  it('cuts the sheeting by panel: each sheet is the template cut for that panel and surface', () => {
    const { a, parts, pieces } = build(builtUp)
    const sheets = pieces.filter((p) => p.kind === 'sheet')
    expect(sheets).toHaveLength(2 * panelRuns(a).length)
    for (const s of sheets) {
      const part = parts.find((p) => p.id === s.part)
      expect(part?.group, s.name).toBe('sheeting')
      expect(part.notes[0].startsWith(s.name.startsWith('Top') ? 'Top' : 'Bottom')).toBe(true)
    }
    expect(new Set(sheets.map((s) => s.part)).size).toBe(sheets.length)
  })

  it('makes a servo one piece of its case, lugs, boss and lead, and its plate another', () => {
    const { pieces } = build((st) => builtUp(st), (input) => (input.mass = 2))
    const servos = pieces.filter((p) => p.id.startsWith('servo-'))
    expect(servos.length).toBeGreaterThan(0)
    // A servo is bought, not cut: no part, so the Part card doesn't show its plate for it
    for (const s of servos) {
      expect(s.solids.length).toBeGreaterThanOrEqual(4)
      expect(s.part).toBeNull()
    }
    const plate = pieces.find((p) => p.id === `plate-${servos[0].id.slice(6)}`)
    expect(plate.part).toBe(servos[0].id.slice(6))
  })

  it('draws a silhouette of every piece for the list', () => {
    const { w, pieces } = build(builtUp)
    for (const p of pieces) expect(pieceOutline(w, p).length, p.name).toBeGreaterThanOrEqual(3)
  })

  it('finds the span station of a world point, across a dihedral break', () => {
    const { a } = build(builtUp)
    for (const s of [a.rootS + 0.01, 0.3, 0.59, 0.61, 0.85]) {
      const sec = a.section(s)
      for (const f of [0.1, 0.5, 0.9]) expect(spanOf(a, worldPoint(a, s, sec.xl + f * sec.c, 0.01))).toBeCloseTo(s, 5)
    }
  })

  it("gives a foam wing's cores and skins as pieces, each skin its panel's", () => {
    const { a, parts, pieces } = build((st) => (st.construction = 'foam'))
    expect(pieces.filter((p) => p.kind === 'core').length).toBeGreaterThan(0)
    const skins = pieces.filter((p) => p.kind === 'sheet')
    expect(skins).toHaveLength(2 * panelRuns(a).length)
    for (const s of skins) expect(parts.find((p) => p.id === s.part)?.group, s.name).toBe('skins')
    // A core picked where it is gives the nearer template
    const core = pieces.find((p) => p.kind === 'core')
    const templates = parts.filter((p) => p.group === 'templates')
    for (const t of templates) expect(partFor(parts, { groups: ['templates'] }, t.s + (t.end === 'inner' ? 0.01 : -0.01))).toBe(t.id)
    expect(core.name).toMatch(/^Foam core/)
  })
})

describe('drawing a piece that is not cut from sheet', () => {
  const size = (d) => bounds(d.shapes.flatMap((s) => s.pts))
  const dimLength = (m) => Math.hypot(m.to[0] - m.from[0], m.to[1] - m.from[1])

  it("draws a cap strip's side profile at its length", () => {
    const { a, st, pieces } = build((x) => (x.covering.type = 'open'))
    const strips = pieces.filter((p) => p.capStrip)
    expect(strips.length).toBeGreaterThan(4)
    for (const p of strips) {
      const d = pieceDrawing(a, st, p)
      expect(d.shapes[0].pts).toBe(p.capStrip.outline)
      expect(dimLength(d.dims[0])).toBeCloseTo(size(d).w, 9)
    }
  })

  it('draws each strip at mid-span in section, dimensioned across and up', () => {
    const { a, st, pieces } = build(builtUp)
    const strip = pieces.filter((p) => ['spar', 'le', 'te', 'teMoving', 'hinge', 'hingeMoving', 'stringer'].includes(p.kind))
    expect(strip.length).toBeGreaterThan(6)
    for (const p of strip) {
      const d = pieceDrawing(a, st, p)
      expect(d, p.name).toBeTruthy()
      const b = size(d)
      expect(b.x0).toBeCloseTo(0, 9)
      expect(b.y0).toBeCloseTo(0, 9)
      expect(dimLength(d.dims[0])).toBeCloseTo(b.w, 9)
      expect(dimLength(d.dims[1])).toBeCloseTo(b.h, 9)
      // Hatched and labelled as a section, not a flat part
      expect(d.shapes[0].kind).toBe('section')
      expect(d.label).toBe('Section')
    }
    // A spar cap is its stock: the cap's width by its thickness
    const cap = pieces.find((p) => p.name === 'Spar cap, top')
    const b = size(pieceDrawing(a, st, cap))
    expect(b.h).toBeCloseTo(st.spar.capThickness, 4)
    expect(b.w).toBeCloseTo(st.spar.capWidth, 3)
  })

  it("draws a foam core's block at the size the cut list gives, with the core's two ends in it", () => {
    const { a, st, pieces, cutList } = build((x) => (x.construction = 'foam'))
    for (const p of pieces.filter((x) => x.kind === 'core')) {
      const d = pieceDrawing(a, st, p)
      expect(d, p.name).toBeTruthy()
      const core = a.cores.find((c) => p.coreAt >= c.from - 1e-9 && p.coreAt <= c.to + 1e-9)
      const block = cutList.find((c) => c.item === `Foam block, ${core.name}`)
      expect(dimLength(d.dims[0])).toBeCloseTo(block.size[0], 9)
      expect(dimLength(d.dims[1])).toBeCloseTo(block.size[1], 9)
      expect(d.extra.blockLength).toBeCloseTo(block.length, 9)
      expect(d.shapes.map((s) => s.kind)).toEqual(['cut', 'line', 'dash'])
    }
  })

  it("draws a servo from the side: across its lugs, up to them and up to the horn seat", () => {
    const { a, st, pieces } = build((x) => builtUp(x))
    const servo = pieces.find((p) => p.servo)
    const d = pieceDrawing(a, st, servo)
    const f = servo.servo.frame
    expect(dimLength(d.dims[0])).toBeCloseTo(f.lugSpan, 9)
    expect(dimLength(d.dims[1])).toBeCloseTo(f.lugHeight, 9)
    expect(dimLength(d.dims[2])).toBeCloseTo(f.output.top, 9)
    // The case, its two lugs and the output boss filled; the lead drawn
    expect(d.shapes.filter((s) => s.kind === 'cut').length).toBeGreaterThanOrEqual(4)
  })
})
