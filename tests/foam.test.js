// Foam-core construction: settings and migration, the sandwich check against a hand
// calculation, the wrinkling and core shear formulas, the weight, the hot-wire templates'
// geometry, and their DXF.
import { describe, it, expect } from 'vitest'
import { defaultState, migrate } from '../src/lib/projects.js'
import { resolveAirfoil, airfoilPerformance } from '../src/lib/airfoils.js'
import { wingGeometry } from '../src/lib/calc.js'
import { wingSampler, projectedSampler, normalisePanels } from '../src/lib/wing.js'
import { analyseStructure, defaultStructure, MATERIALS, sparSection } from '../src/lib/structure.js'
import { FOAM_MATERIALS, defaultFoam, foamStructure, wrinklingStress, coreShearStress, skinSheet, WRINKLE_Q } from '../src/lib/foam.js'
import { coreProfile, coreArea, coreVolume, pairDatum, skinWidth } from '../src/lib/foamParts.js'
import { buildParts, bounds, polygonArea } from '../src/lib/ribs.js'
import { partsDxf, templatesDxf, parseDxf, cutListCsv, defaultExportOptions } from '../src/lib/dxf.js'
import { wing3d, sectionAt } from '../src/lib/wing3d.js'
import { isoThumb } from '../src/lib/thumbnails.js'
import { newSurface, defaultControls } from '../src/lib/controlSurfaces.js'
import { newBrake } from '../src/lib/airBrakes.js'

function inside(poly, [x, y]) {
  let c = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c
  }
  return c
}
// Distance from a point to a closed polygon's edges
function distTo(poly, [x, y]) {
  let d = Infinity
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i]
    const [bx, by] = poly[(i + 1) % poly.length]
    const L2 = (bx - ax) ** 2 + (by - ay) ** 2
    const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / L2)) : 0
    d = Math.min(d, Math.hypot(x - ax - t * (bx - ax), y - ay - t * (by - ay)))
  }
  return d
}

// A foam wing: the default 1.4 m model unless edited
function build({ wing = () => {}, edit = () => {}, airfoil = null, controls = defaultControls(), handedness = 'pair', wireKerf, leadIn } = {}) {
  const s = defaultState()
  wing(s.input)
  if (airfoil) {
    s.airfoil.source = 'custom'
    s.airfoil.custom = { ...s.airfoil.custom, ...airfoil }
  }
  const st = defaultStructure()
  st.construction = 'foam'
  edit(st)
  const af = resolveAirfoil(s.airfoil)
  const g = wingGeometry({ ...s.input, mode: 'panels' })
  const planform = projectedSampler(wingSampler(s.input, af.params.thickness))
  const perf = airfoilPerformance(af, { mass: s.input.mass, area: g.projectedArea, chord: g.mac, wing: { planform, span: g.span, sweepCos: 1 } })
  const a = analyseStructure({ wing: s.input, airfoil: af, structure: st, mass: s.input.mass, spanwise: perf.spanwise, controls })
  return { a, st: a.structure, input: s.input, ...buildParts(a, a.structure, { handedness, wireKerf, leadIn }) }
}
// A symmetrical section with no edge stock, so the hand calculations are simple
const plain = (st) => {
  st.le = { ...st.le, type: 'none' }
  st.te = { ...st.te, stock: 'custom', width: 0, type: 'flat' }
}

describe('foam settings', () => {
  it('defaults to built-up, with foam settings ready', () => {
    const st = defaultStructure()
    expect(st.construction).toBe('built-up')
    expect(st.foam).toEqual(defaultFoam())
  })

  it('migrates a structure saved before foam cores to built-up, with the foam defaults', () => {
    const old = defaultState()
    delete old.input.structure.construction
    delete old.input.structure.foam
    delete old.input.exportOptions.wireKerf
    delete old.input.exportOptions.parts.templates
    const m = migrate(JSON.parse(JSON.stringify(old)))
    expect(m.input.structure.construction).toBe('built-up')
    expect(m.input.structure.foam).toEqual(defaultFoam())
    expect(m.input.exportOptions.wireKerf).toBe(0.001)
    expect(m.input.exportOptions.parts.templates).toBe(true)
  })

  it('fills in foam settings missing from a partial save', () => {
    const old = defaultState()
    old.input.structure.construction = 'foam'
    old.input.structure.foam = { core: 'xps', skin: { thickness: 0.0015 } }
    const m = migrate(JSON.parse(JSON.stringify(old)))
    expect(m.input.structure.foam.core).toBe('xps')
    expect(m.input.structure.foam.skin.thickness).toBe(0.0015)
    expect(m.input.structure.foam.skin.material).toBe('obechi')
    expect(m.input.structure.foam.caps).toEqual(defaultFoam().caps)
  })

  it('has foam materials in the catalogue, the foams light and soft', () => {
    for (const k of ['eps-15', 'eps-20', 'eps-30', 'xps', 'obechi', 'carbon-tow']) expect(MATERIALS[k]).toBe(FOAM_MATERIALS[k])
    for (const k of ['eps-15', 'eps-20', 'eps-30', 'xps']) {
      const f = MATERIALS[k]
      expect(f.density).toBeLessThan(40)
      expect(f.G).toBeLessThan(f.E)
      expect(f.shear).toBeGreaterThan(0)
    }
    // Denser EPS is stiffer and stronger
    expect(MATERIALS['eps-30'].shear).toBeGreaterThan(MATERIALS['eps-20'].shear)
    expect(MATERIALS['eps-20'].E).toBeGreaterThan(MATERIALS['eps-15'].E)
  })

  it('lays a foam wing out as a fully sheeted wing on caps, with no ribs', () => {
    const st = foamStructure({ ...defaultStructure(), construction: 'foam' })
    expect(st.covering.type).toBe('sheeted')
    expect(st.covering.sheetMaterial).toBe('obechi')
    expect(st.spar).toMatchObject({ type: 'caps', capMaterial: 'carbon', capWidth: 0.006, capThickness: 0.0005, webThickness: 0 })
    expect(st.ribs.thickness).toBe(0)
    expect(st.stringers).toEqual([])
    expect(st.construction).toBe('foam')
  })

  it("uses the material's usual sheet size unless one is set", () => {
    expect(skinSheet({ material: 'obechi' })).toEqual({ width: 0.3, length: 1 })
    expect(skinSheet({ material: 'balsa-medium' })).toEqual({ width: 0.1, length: 0.915 })
    expect(skinSheet({ material: 'obechi', sheetWidth: 0.6, sheetLength: null })).toEqual({ width: 0.6, length: 1 })
  })
})

describe('sandwich formulas', () => {
  it('works out face wrinkling as Q (Ef Ec Gc)^(1/3)', () => {
    const core = { E: 4e6, G: 1.6e6 }
    // 0.5 × (6e9 × 4e6 × 1.6e6)^(1/3) = 0.5 × 3.3740e7
    expect(wrinklingStress(6e9, core)).toBeCloseTo(0.5 * 3.3740e7, -4)
    expect(WRINKLE_Q).toBe(0.5)
    // Doubling both core moduli raises it by the cube root of 4
    expect(wrinklingStress(6e9, { E: 8e6, G: 3.2e6 }) / wrinklingStress(6e9, core)).toBeCloseTo(Math.cbrt(4), 6)
    expect(wrinklingStress(6e9, { E: 0, G: 1 })).toBe(0)
  })

  it('works out the core shear over the cap width plus the depth', () => {
    // 40 N over (6 + 20) mm by 20 mm
    expect(coreShearStress(40, { capWidth: 0.006, d: 0.02 })).toBeCloseTo(40 / (0.026 * 0.02), 6)
    expect(coreShearStress(-40, { capWidth: 0.006, d: 0.02 })).toBeGreaterThan(0)
    expect(coreShearStress(40, { capWidth: 0.006, d: 0 })).toBe(Infinity)
  })
})

describe('foam wing structure check', () => {
  it('checks caps, skin crushing, wrinkling and core shear, and none of the rib modes', () => {
    const { a } = build()
    expect(a.construction).toBe('foam')
    expect(a.ribs).toEqual([])
    expect(a.cores).toEqual([{ name: 'panel 1', from: 0, to: 0.7 }])
    const modes = Object.keys(a.summary.modes)
    expect(modes.sort()).toEqual(['compression', 'coreShear', 'sheet', 'tension', 'wrinkling'])
    expect(a.modeLabels.sheet).toBe('Skin crushing')
    // The default foam wing is sound
    expect(a.summary.worst.ms).toBeGreaterThan(0)
  })

  it('matches a hand calculation of the sandwich at the root', () => {
    // Symmetrical 12% section, no edge stock, no servo or brakes: the neutral axis is the chord
    // line, and thin-face theory gives EI from the caps and skins alone
    const { a, st } = build({ airfoil: { camberPct: 0, thicknessPct: 12 }, edit: plain })
    const row = a.stations[0]
    const sec = a.section(row.s)
    const t = st.covering.sheetThickness
    const Es = MATERIALS.obechi.E
    const cap = st.spar
    const Ec = MATERIALS.carbon.E
    // Skins: strips across the chord at the mid-thickness of each skin, both surfaces
    let EI = 0
    const n = 400
    for (let i = 0; i < n; i++) {
      const q = (i + 0.5) / n
      const f = sec.surf(q)
      EI += Es * t * (sec.c / n) * ((f.upper - t / 2) ** 2 + (f.lower + t / 2) ** 2)
    }
    // Caps under the skins at the spar
    const up = sec.surf(row.sparXi).upper - t
    const zc = up - cap.capThickness / 2
    EI += 2 * Ec * cap.capWidth * cap.capThickness * zc ** 2
    expect(row.EI).toBeGreaterThan(EI * 0.97)
    expect(row.EI).toBeLessThan(EI * 1.03)
    // The cap's compression at its outer face, positive g
    expect(Math.abs(row.sigma / ((Ec * row.M * up) / EI) - 1)).toBeLessThan(0.03)
    // Skin crushing and wrinkling against the stress in the skin at the top of the section
    const sf = a.safetyFactor
    const zTop = Math.max(...Array.from({ length: 101 }, (_, i) => sec.surf(i / 100).upper))
    const skinStress = (Es * row.M * zTop) / EI
    expect(Math.abs(row.sheetStress / skinStress - 1)).toBeLessThan(0.03)
    const core = MATERIALS['eps-20']
    const wr = WRINKLE_Q * Math.cbrt(Es * core.E * core.G)
    expect(row.wrinkle).toBeCloseTo(wr, 0)
    expect(row.ms.wrinkling).toBeCloseTo(wr / (row.sheetStress * sf) - 1, 9)
    expect(row.ms.sheet).toBeCloseTo(MATERIALS.obechi.compression / (row.sheetStress * sf) - 1, 9)
    // Core shear: V over (cap width + d) by d, d between the caps' centroids
    const d = 2 * zc
    expect(row.coreTau).toBeCloseTo(row.V / ((cap.capWidth + d) * d), 3)
    expect(row.ms.coreShear).toBeCloseTo(core.shear / (row.coreTau * sf) - 1, 9)
  })

  it('carries the shear in a web when there is one', () => {
    const { a, st } = build({ edit: (s) => (s.foam.web.enabled = true) })
    const row = a.stations[0]
    expect(row.ms.coreShear).toBeUndefined()
    const sp = sparSection(st, row.h, 0)
    expect(row.tau).toBeCloseTo(row.V / (st.foam.web.thickness * sp.d), 6)
    expect(row.ms.webShear).toBeCloseTo(MATERIALS['balsa-medium'].shear / (row.tau * a.safetyFactor) - 1, 9)
  })

  it('warns, with a remedy, when the skin wrinkles or the core shears', () => {
    const { a } = build({
      edit: (s) => {
        s.foam.core = 'eps-15'
        s.foam.caps = { material: 'spruce', width: 0.003, thickness: 0.001 }
        s.foam.skin = { ...s.foam.skin, material: 'balsa-light', thickness: 0.001 }
        s.loads.designG = 12
      },
    })
    const ids = a.warnings.map((w) => w.id)
    expect(ids).toContain('short-coreShear')
    expect(a.warnings.find((w) => w.id === 'short-coreShear').message).toMatch(/shear web/)
    expect(ids).toContain('short-wrinkling')
    expect(a.warnings.find((w) => w.id === 'short-wrinkling').message).toMatch(/denser foam/)
  })

  it('is stronger with denser foam', () => {
    const light = build({ edit: (s) => (s.foam.core = 'eps-15') }).a.summary.modes
    const dense = build({ edit: (s) => (s.foam.core = 'eps-30') }).a.summary.modes
    expect(dense.coreShear.ms).toBeGreaterThan(light.coreShear.ms)
    expect(dense.wrinkling.ms).toBeGreaterThan(light.wrinkling.ms)
    // The caps and skin are the same
    expect(dense.compression.ms).toBeCloseTo(light.compression.ms, 9)
  })

  it('leaves a built-up wing as it was', () => {
    const s = defaultState()
    const af = resolveAirfoil(s.airfoil)
    const g = wingGeometry({ ...s.input, mode: 'panels' })
    const planform = projectedSampler(wingSampler(s.input, af.params.thickness))
    const perf = airfoilPerformance(af, { mass: s.input.mass, area: g.projectedArea, chord: g.mac, wing: { planform, span: g.span, sweepCos: 1 } })
    const a = analyseStructure({ wing: s.input, airfoil: af, structure: defaultStructure(), mass: s.input.mass, spanwise: perf.spanwise })
    expect(a.construction).toBe('built-up')
    expect(a.cores).toEqual([])
    expect(a.ribs.length).toBeGreaterThan(5)
    expect(a.summary.modes.wrinkling).toBeUndefined()
  })
})

describe('foam wing weight', () => {
  it('weighs the core from its volume, and the skins and their glue from their area', () => {
    const rect = (i) => (i.panels = normalisePanels([{ id: 1, length: 0.7, tipChord: 0.25, dihedral: 0 }]))
    const { a, st, weight, parts } = build({ wing: rect, airfoil: { camberPct: 0, thicknessPct: 12 }, edit: plain })
    // Rectangular 0.7 m half wing, 250 mm chord: the core's section is the aerofoil's area less
    // a skin's thickness round its perimeter
    const sec = a.section(0.3)
    let area = 0
    let perim = 0
    let prev = null
    const n = 400
    for (let i = 0; i <= n; i++) {
      const q = 0.5 * (1 - Math.cos((Math.PI * i) / n))
      const f = sec.surf(q)
      if (prev) {
        area += (q - prev.q) * sec.c * ((f.upper - f.lower + prev.u - prev.l) / 2)
        perim += Math.hypot((q - prev.q) * sec.c, f.upper - prev.u) + Math.hypot((q - prev.q) * sec.c, f.lower - prev.l)
      }
      prev = { q, u: f.upper, l: f.lower }
    }
    const t = st.foam.skin.thickness
    const hand = area - perim * t
    expect(coreArea(a, st, 0.3)).toBeGreaterThan(hand * 0.98)
    expect(coreArea(a, st, 0.3)).toBeLessThan(hand * 1.02)
    expect(coreVolume(a, st)).toBeCloseTo(coreArea(a, st, 0.3) * 0.7, 6)
    // Both halves
    expect(weight.by.core).toBeCloseTo(coreVolume(a, st) * MATERIALS['eps-20'].density * 2, 9)
    // The skins: top and bottom, each the surface's length round the section by the span
    const skins = parts.filter((p) => p.group === 'skins')
    expect(skins).toHaveLength(2)
    const skinArea = skins.reduce((m, p) => m + Math.abs(polygonArea(p.outline)), 0)
    expect(skinArea).toBeCloseTo((skinWidth(a, st, 0.3, 'upper') + skinWidth(a, st, 0.3, 'lower')) * 0.7, 6)
    expect(skinArea).toBeGreaterThan(perim * 0.7 * 0.98)
    expect(weight.by.skins).toBeCloseTo(skinArea * t * MATERIALS.obechi.density * 2, 9)
    expect(weight.by.glue).toBeCloseTo(skinArea * 0.1 * 2, 9)
    // Templates weigh nothing; nothing else is double counted
    expect(weight.by.templates).toBe(0)
    expect(weight.total).toBeCloseTo(weight.bare + weight.covering + weight.servos, 9)
    // The skins and glue aren't given the 10% glue allowance on top
    const rest = Object.entries(weight.by)
      .filter(([k]) => !['skins', 'core', 'glue', 'covering'].includes(k))
      .reduce((m, [, v]) => m + v, 0)
    expect(weight.bare).toBeCloseTo(rest * 1.1 + weight.by.skins + weight.by.core + weight.by.glue, 9)
  })

  it('lists the foam blocks and the skin sheets to buy, without weighing them', () => {
    const { cutList, weight } = build()
    const block = cutList.find((c) => c.block)
    expect(block.item).toBe('Foam block, panel 1')
    expect(block.qty).toBe(2)
    expect(block.length).toBeCloseTo(0.72, 6)
    const sheets = cutList.find((c) => c.buy)
    // Each 0.7 m skin needs one 1 m length; the root skin is about 250 mm round, inside one 300 mm sheet
    expect(sheets.qty).toBe(4)
    const csv = cutListCsv([], cutList)
    expect(csv).toContain('Foam block, panel 1')
    expect(csv).toMatch(/block/)
    expect(weight.by.strip).toBeGreaterThan(0)
  })

  it('joins skin sheets across the width when the skin is wider than a sheet', () => {
    const { cutList, parts } = build({ edit: (s) => (s.foam.skin = { ...s.foam.skin, material: 'balsa-medium', thickness: 0.0015 }) })
    // 250 mm round on 100 mm balsa: three sheets across, one length each
    const k1 = parts.find((p) => p.name === 'K1')
    expect(k1.notes[1]).toMatch(/^3 sheets joined edge to edge/)
    expect(cutList.find((c) => c.buy).qty).toBe(3 * 2 + 3 * 2)
  })
})

describe('hot-wire templates', () => {
  const swept = (input) => {
    input.rootChord = 0.25
    input.panels = normalisePanels([
      { id: 1, length: 0.4, tipChord: 0.22, sweep: 0.03, dihedral: 0, washout: 1 },
      { id: 2, length: 0.3, tipChord: 0.15, sweep: 0.05, dihedral: 6, washout: 3 },
    ])
  }

  it('makes a pair per panel, root outward', () => {
    const { parts } = build({ wing: swept })
    const t = parts.filter((p) => p.group === 'templates')
    expect(t.map((p) => p.name)).toEqual(['HW1-I', 'HW1-O', 'HW2-I', 'HW2-O'])
    expect(t.every((p) => p.qty === 1 && p.material === 'template-stock')).toBe(true)
    // The break between the panels is bevelled for the dihedral
    expect(t[1].notes.some((n) => /Dihedral joint here: sand the core's end 3.0°/.test(n))).toBe(true)
  })

  it('grows the core by half the kerf all round', () => {
    const { a, st, parts } = build({ edit: plain, wireKerf: 0.002 })
    const p = coreProfile(a, st, 0)
    const tpl = parts.find((x) => x.name === 'HW1-I')
    // In the pair's frame: shift the core by the same datum
    const datum = pairDatum(p, coreProfile(a, st, 0.7))
    const core = p.outline.map(([x, h]) => [x - datum.x, h - datum.z])
    expect(Math.abs(polygonArea(tpl.outline))).toBeGreaterThan(Math.abs(polygonArea(core)))
    // Every point of the core inside the template, 1 mm in from its edge (away from the sharp
    // corners, where the mitre or bevel stands further off)
    for (const pt of core.slice(5, -5)) {
      expect(inside(tpl.outline, pt)).toBe(true)
      expect(distTo(tpl.outline, pt)).toBeGreaterThan(0.0009)
      expect(distTo(tpl.outline, pt)).toBeLessThan(0.0011 + 1e-4)
    }
    // No kerf: the template is the core
    const zero = build({ edit: plain, wireKerf: 0 }).parts.find((x) => x.name === 'HW1-I')
    expect(Math.abs(polygonArea(zero.outline))).toBeCloseTo(Math.abs(polygonArea(core)), 9)
  })

  it('is a closed outline between the skins, from the edge stock in front to the stock behind', () => {
    const { a, st } = build()
    const p = coreProfile(a, st, 0)
    const sec = a.section(0)
    expect(p.x0).toBeCloseTo(sec.xl + st.le.width, 9)
    expect(p.x1).toBeCloseTo(sec.xl + sec.c - st.te.width, 4)
    // Closed: upper front to back, then lower back to front, ending under its first point
    expect(p.outline[0][0]).toBeCloseTo(p.outline.at(-1)[0], 9)
    expect(p.outline[0][1]).toBeGreaterThan(p.outline.at(-1)[1])
    // Inside the section by the skin's thickness
    for (const [x, h] of p.upper.slice(1, -1)) expect(h).toBeLessThan(sec.surf((x - sec.xl) / sec.c).upper - st.covering.sheetThickness * 0.99)
  })

  it('builds the twist into each end, both in one frame with the sweep', () => {
    const { a, st, parts } = build({ wing: swept, edit: plain })
    const ends = [parts.find((p) => p.name === 'HW2-I'), parts.find((p) => p.name === 'HW2-O')]
    // The chord line of each template, front point to back point at mid-depth: its angle is
    // the twist there (TE up for washout)
    const chordAngle = (s) => {
      const p = coreProfile(a, st, s)
      const mid = (i) => (p.upper[i][1] + p.lower[i][1]) / 2
      return (Math.atan2(mid(p.upper.length - 1) - mid(0), p.x1 - p.x0) * 180) / Math.PI
    }
    const inner = a.cores[1].from
    const outer = a.cores[1].to
    const diff = chordAngle(outer) - chordAngle(inner)
    expect(diff).toBeGreaterThan(1.5)
    expect(diff).toBeLessThan(2.5)
    // The common frame: the outer template's front lies as far aft of the inner's as the
    // leading edge sweeps back across the panel
    const front = (p) => bounds(p.outline).x0
    const sweep = a.section(outer).xl - a.section(inner).xl
    expect(front(ends[1]) - front(ends[0])).toBeCloseTo(sweep, 3)
    // The vertical mark (u = 0) and the level line (z = 0) are on both templates
    for (const t of ends) {
      expect(inside(t.outline, [0, 0])).toBe(true)
      const vertical = t.etch.find((l) => l.length === 2 && Math.abs(l[0][0]) < 1e-12 && Math.abs(l[1][0]) < 1e-12)
      const level = t.etch.find((l) => l.length === 2 && Math.abs(l[0][1]) < 1e-12 && Math.abs(l[1][1]) < 1e-12)
      expect(vertical).toBeTruthy()
      expect(level).toBeTruthy()
    }
  })

  it('draws the lead-in behind the trailing edge and the lead-out ahead of the front', () => {
    const { parts } = build({ leadIn: 0.03 })
    const t = parts.find((p) => p.name === 'HW1-I')
    const b = bounds(t.outline)
    const [lin, lout] = t.guide
    expect(lin[1][0]).toBeCloseTo(b.x1, 3)
    expect(lin[0][0] - lin[1][0]).toBeCloseTo(0.03, 9)
    expect(lout[0][0]).toBeCloseTo(b.x0, 3)
    expect(lout[0][0] - lout[1][0]).toBeCloseTo(0.03, 9)
  })

  it('marks the hinge line of a control surface on the panel, and its own core in 3D', () => {
    const controls = { ...defaultControls(), surfaces: [newSurface('aileron', 1, 0.35, 0.65, 1)], bays: [{ surface: 1, enabled: false }] }
    const { a, st, parts } = build({ controls })
    const sf = a.surfaces[0]
    expect(sf.ok).toBe(true)
    const t = parts.find((p) => p.name === 'HW1-O')
    expect(t.notes.some((n) => /Aileron A1: hinge line engraved \(extended to this end\)/.test(n))).toBe(true)
    // No surface ribs on a foam wing
    expect(parts.some((p) => p.group === 'surfaces' || p.group === 'ribs')).toBe(false)
    const model = wing3d(a, st, parts)
    expect(model.solids.filter((x) => x.kind === 'core')).toHaveLength(3)
    expect(model.solids.filter((x) => x.kind === 'coreMoving')).toHaveLength(1)
    expect(model.ribs).toHaveLength(0)
    const cut = sectionAt(a, st, parts, 0.2).pieces
    expect(cut.some((p) => p.kind === 'core')).toBe(true)
    // The spar is the two caps under the skins; with no shear web turned on there's no web, not
    // even a sliver of no thickness (which the section once drew as a line through the core)
    expect(cut.filter((p) => p.kind === 'spar')).toHaveLength(2)
    expect(cut.some((p) => p.kind === 'web')).toBe(false)
    expect(model.solids.some((x) => x.kind === 'web')).toBe(false)
  })

  it('makes routing templates for the servo and air brake pockets', () => {
    const controls = { ...defaultControls(), surfaces: [newSurface('aileron', 1, 0.35, 0.65, 1)], brakes: [newBrake('blade', 1, 0.2, 1), newBrake('spoiler', 1, 0.7, 2)] }
    const { a, parts } = build({
      wing: (i) => {
        i.rootChord = 0.4
        i.panels = normalisePanels([{ id: 1, length: 0.8, tipChord: 0.35, dihedral: 0 }])
        i.mass = 2
      },
      controls,
    })
    const bays = a.bays.filter((b) => b.ok)
    expect(bays.length).toBeGreaterThan(0)
    const pockets = parts.filter((p) => p.group === 'pockets')
    expect(pockets.map((p) => p.name)).toContain(`${bays[0].name}-T`)
    const p = pockets.find((x) => x.name === `${bays[0].name}-T`)
    const hole = bounds(p.holes[0])
    expect(hole.w).toBeCloseTo(bays[0].hatch.s1 - bays[0].hatch.s0, 9)
    expect(hole.h).toBeCloseTo(bays[0].hatch.x1 - bays[0].hatch.x0, 9)
    const plate = parts.find((x) => x.name === bays[0].name)
    expect(plate.notes[0]).toMatch(/into its pocket in the core/)
    expect(a.brakes.filter((x) => x.ok).length).toBe(2)
    for (const r of a.brakes.filter((x) => x.ok)) expect(pockets.map((x) => x.name)).toContain(`${r.name}-T`)
    // Every part has its own id (a spoiler's plate is AB1-P)
    expect(new Set(parts.map((x) => x.id)).size).toBe(parts.length)
  })
})

describe('foam wing DXF and views', () => {
  it('writes the templates as one DXF: a closed cut per template, engraving and lead lines', () => {
    const { parts } = build()
    const f = templatesDxf(parts, defaultExportOptions(), 'test')
    expect(f.name).toBe('test-hot-wire-templates.dxf')
    const d = parseDxf(f.text)
    expect(d.version).toBe('AC1009')
    const cut = d.polylines.filter((p) => p.layer === 'CUT')
    expect(cut).toHaveLength(2)
    expect(cut.every((p) => p.closed)).toBe(true)
    expect(d.polylines.some((p) => p.layer === 'ENGRAVE')).toBe(true)
    expect(d.polylines.filter((p) => p.layer === 'GUIDE' && p.pts.length === 2).length).toBeGreaterThanOrEqual(4)
    // In millimetres: the template is about the chord long
    const b = bounds(cut[0].pts)
    expect(b.w).toBeGreaterThan(200)
    expect(b.w).toBeLessThan(260)
  })

  it('puts the templates and pocket routing templates in the parts DXF, skins on request', () => {
    const { parts } = build()
    const opts = defaultExportOptions()
    const text = partsDxf(parts, opts, 'w')[0].text
    expect(text).toContain('CUT')
    const titled = partsDxf(parts, { ...opts, split: true }, 'w').map((x) => x.title)
    expect(titled.some((x) => x.startsWith('Hot-wire templates'))).toBe(true)
    expect(titled.some((x) => x.startsWith('Skins'))).toBe(false)
    const withSkins = partsDxf(parts, { ...opts, split: true, parts: { ...opts.parts, skins: true } }, 'w').map((x) => x.title)
    expect(withSkins.some((x) => x.startsWith('Skins'))).toBe(true)
  })

  it('draws the cores in the 3D thumbnail', () => {
    const { a, st, parts } = build()
    const th = isoThumb(a, st, parts)
    expect(th.lines.filter((l) => l.kind === 'rib')).toHaveLength(2)
  })
})
