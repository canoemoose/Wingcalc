// Servo bays: the catalogue, where each bay goes, its mount plate, hatch and lead holes in the
// ribs, the servos' weight, and their inertia relief in the spar's bending.
import { describe, it, expect } from 'vitest'
import { defaultState, migrate } from '../src/lib/projects.js'
import { resolveAirfoil, airfoilPerformance } from '../src/lib/airfoils.js'
import { wingGeometry, G } from '../src/lib/calc.js'
import { wingSampler, projectedSampler, normalisePanels } from '../src/lib/wing.js'
import { analyseStructure, defaultStructure, spanLoads, MIN_MATERIAL } from '../src/lib/structure.js'
import { buildParts, bounds, polygonArea } from '../src/lib/ribs.js'
import { partsDxf, planDxf, parseDxf, cutListCsv, defaultExportOptions } from '../src/lib/dxf.js'
import { wing3d, servoBox } from '../src/lib/wing3d.js'
import { newSurface, defaultControls, resolveSurfaces } from '../src/lib/controlSurfaces.js'
import { SERVOS, SERVO_CLASSES, SERVO_CLEARANCE, defaultServoClass, bayOf, setBay, dropBay, placeBays, servoMasses } from '../src/lib/servos.js'

function inside(poly, [x, y]) {
  let c = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c
  }
  return c
}
// The rib material above and below a hole: the vertical line through its centre meets the
// outline at the bottom and top of the rib there
function rimsOf(outline, hole) {
  const b = bounds(hole)
  const u = (b.x0 + b.x1) / 2
  const zs = []
  for (let i = 0; i < outline.length; i++) {
    const [x0, y0] = outline[i]
    const [x1, y1] = outline[(i + 1) % outline.length]
    if ((x0 <= u && u < x1) || (x1 <= u && u < x0)) zs.push(y0 + ((y1 - y0) * (u - x0)) / (x1 - x0))
  }
  const lo = Math.min(...zs)
  const hi = Math.max(...zs)
  return { below: b.y0 - lo, above: hi - b.y1 }
}

// A wing deep enough behind the spar for a micro servo: one 0.9 m panel, 450 to 400 mm chord
const deepWing = (input) => {
  input.rootChord = 0.45
  input.panels = normalisePanels([{ id: 1, length: 0.9, tipChord: 0.4, dihedral: 0 }])
  input.mass = 2
}
const aileron = newSurface('aileron', 1, 0.5, 0.85, 1)
const flap = newSurface('flap', 1, 0.1, 0.4, 2)

function build({ surfaces = [aileron, flap], bays = [], edit = () => {}, wingEdit = deepWing, handedness = 'pair', airfoilThickness = null } = {}) {
  const s = defaultState()
  wingEdit(s.input)
  if (airfoilThickness) {
    s.airfoil.source = 'custom'
    s.airfoil.custom = { ...s.airfoil.custom, thicknessPct: airfoilThickness }
  }
  const st = defaultStructure()
  st.le.stock = 'custom'
  st.te.stock = 'custom'
  edit(st)
  const controls = { ...defaultControls(), surfaces, bays }
  const airfoil = resolveAirfoil(s.airfoil)
  const g = wingGeometry({ ...s.input, mode: 'panels' })
  const planform = projectedSampler(wingSampler(s.input, airfoil.params.thickness))
  const perf = airfoilPerformance(airfoil, { mass: s.input.mass, area: g.projectedArea, chord: g.mac, wing: { planform, span: g.span, sweepCos: 1 } })
  const a = analyseStructure({ wing: s.input, airfoil, structure: st, mass: s.input.mass, spanwise: perf.spanwise, controls })
  return { a, st: a.structure, input: s.input, controls, perf, airfoil, ...buildParts(a, a.structure, { handedness }) }
}
const noBays = (list = [aileron, flap]) => list.map((x) => ({ surface: x.id, enabled: false }))

describe('servo catalogue', () => {
  it('has four classes, each larger, heavier and stronger than the one before', () => {
    expect(SERVO_CLASSES).toEqual(['sub-micro', 'micro', 'mini', 'standard'])
    for (let i = 0; i < SERVO_CLASSES.length; i++) {
      const v = SERVOS[SERVO_CLASSES[i]]
      for (const k of ['length', 'width', 'height', 'lugSpan', 'lugThickness', 'lugHeight', 'mass', 'torque', 'plate', 'leadHole']) {
        expect(v[k], `${SERVO_CLASSES[i]} ${k}`).toBeGreaterThan(0)
      }
      // The lugs stick out past the case, and sit part way up it
      expect(v.lugSpan).toBeGreaterThan(v.length)
      expect(v.lugHeight).toBeLessThan(v.height)
      if (i) {
        const p = SERVOS[SERVO_CLASSES[i - 1]]
        for (const k of ['length', 'height', 'lugSpan', 'mass', 'torque']) expect(v[k], k).toBeGreaterThan(p[k])
      }
    }
    // Real-world sizes: a 9 g micro servo is 9 g, and a standard case is about 4 cm long
    expect(SERVOS.micro.mass).toBeCloseTo(0.009, 6)
    expect(SERVOS.standard.length).toBeGreaterThan(0.035)
    expect(SERVOS.standard.length).toBeLessThan(0.045)
  })

  it('picks a class to suit the model weight', () => {
    expect(defaultServoClass(0.4)).toBe('sub-micro')
    expect(defaultServoClass(1.4)).toBe('micro')
    expect(defaultServoClass(4)).toBe('mini')
    expect(defaultServoClass(10)).toBe('standard')
    expect(defaultServoClass(0)).toBe('micro')
  })
})

describe('servo bay settings', () => {
  it('gives every surface a bay unless it is removed, and saves only what differs', () => {
    const c = defaultControls()
    expect(c.bays).toEqual([])
    expect(bayOf(c, 7)).toEqual({ surface: 7, enabled: true, class: null, mounting: 'upright', at: null })
    const a = setBay(c, 1, { class: 'mini' })
    expect(a.bays).toEqual([{ surface: 1, class: 'mini' }])
    expect(bayOf(a, 1).class).toBe('mini')
    // Back to the defaults drops it from the saved list
    expect(setBay(a, 1, { class: null }).bays).toEqual([])
    const b = setBay(a, 1, { enabled: false, at: 0.25 })
    expect(b.bays).toEqual([{ surface: 1, enabled: false, class: 'mini', at: 0.25 }])
    expect(dropBay(b, 1).bays).toEqual([])
    // Other surfaces' settings are left alone
    expect(setBay(setBay(c, 1, { class: 'micro' }), 2, { enabled: false }).bays).toHaveLength(2)
  })

  it('migrates saves from before servo bays, and keeps saved ones', () => {
    const old = defaultState()
    delete old.input.controls.bays
    expect(migrate(old).input.controls.bays).toEqual([])
    const older = defaultState()
    delete older.input.controls
    expect(migrate(older).input.controls.bays).toEqual([])
    const saved = defaultState()
    saved.input.controls.surfaces = [aileron]
    saved.input.controls.bays = [{ surface: 1, class: 'mini', at: 0.4 }]
    expect(migrate(JSON.parse(JSON.stringify(saved))).input.controls.bays).toEqual([{ surface: 1, class: 'mini', at: 0.4 }])
  })
})

describe('where a bay goes', () => {
  const wing = () => {
    const s = defaultState()
    deepWing(s.input)
    return wingSampler(s.input, 0.12)
  }
  const place = (surfaces, bays, mass = 2) => {
    const sampler = wing()
    return placeBays({ sampler, surfaces: resolveSurfaces(sampler, surfaces), controls: { ...defaultControls(), surfaces, bays }, mass, ribThickness: 0.002 })
  }

  it('puts one a third of the way out along each surface, named root outward, between two ribs', () => {
    const [b1, b2] = place([aileron, flap], [])
    expect([b1.name, b2.name]).toEqual(['SB1', 'SB2'])
    expect(b1.surface).toBe(2) // the flap is inboard
    expect(b1.s).toBeCloseTo(0.1 + 0.3 / 3, 9)
    expect(b2.s).toBeCloseTo(0.5 + 0.35 / 3, 9)
    const v = SERVOS.micro // 2 kg: micro
    expect(b1.class).toBe('micro')
    expect(b1.width).toBeCloseTo(v.width + 2 * SERVO_CLEARANCE, 9)
    // The ribs' centres are half the gap and half a rib out from the centre
    expect(b1.sB - b1.sA).toBeCloseTo(b1.width + 0.002, 9)
    expect((b1.sA + b1.sB) / 2).toBeCloseTo(b1.s, 9)
    expect(b1.ok && b2.ok).toBe(true)
  })

  it('takes the class and position chosen, from the panel inner end', () => {
    const [b] = place([aileron], [{ surface: 1, class: 'standard', at: 0.6 }])
    expect(b.class).toBe('standard')
    expect(b.s).toBeCloseTo(0.6, 9)
    expect(b.width).toBeCloseTo(SERVOS.standard.width + 0.003, 9)
  })

  it('leaves out a removed bay, and flags the ones that cannot go', () => {
    expect(place([aileron, flap], noBays([flap]))).toHaveLength(1)
    // Too close to the panel's end, which has a rib of its own
    expect(place([aileron], [{ surface: 1, at: 0.898 }])[0]).toMatchObject({ ok: false, problem: 'span' })
    // A bay sticking out past the end of its surface is allowed but noted
    expect(place([aileron], [{ surface: 1, at: 0.855 }])[0]).toMatchObject({ ok: true, beyond: true })
    // Two on one spot
    const two = place([aileron, flap], [{ surface: 2, at: 0.25 }, { surface: 1, at: 0.256 }])
    expect(two.map((b) => b.ok)).toEqual([true, false])
    expect(two[1].problem).toBe('overlap')
    // A surface that can't be placed has no bay built
    const bad = place([{ ...aileron, panel: 99 }], [])
    expect(bad[0]).toMatchObject({ ok: false, problem: 'surface' })
    expect(servoMasses(bad)).toEqual([])
  })
})

describe('built servo bays', () => {
  const res = build()
  const [b1, b2] = res.a.bays

  it('puts a hard point at each end of the bay', () => {
    for (const b of res.a.bays) {
      expect(b.ok).toBe(true)
      for (const s of [b.sA, b.sB]) {
        const rib = res.a.ribs.find((r) => Math.abs(r.s - s) < 1e-3)
        expect(rib, `rib at ${s}`).toBeTruthy()
        expect(rib.kind).toBe('hard')
      }
      // And no rib between them
      expect(res.a.ribs.filter((r) => r.s > b.sA + 1e-3 && r.s < b.sB - 1e-3)).toHaveLength(0)
    }
    expect(res.skipped).toEqual([])
  })

  it('lays the servo between the main spar and the hinge, deep enough', () => {
    for (const b of res.a.bays) {
      const sf = res.a.surfaces.find((r) => r.id === b.surface)
      // Lugs wholly between the spar's rear face and the fixed hinge spar's front face
      for (const s of [b.sA, b.sB]) {
        expect(b.plate.x1).toBeLessThan(sf.faces.fixedFront(s))
        expect(b.plate.x0).toBeGreaterThan(res.a.sparX(s))
      }
      expect(b.lugs.x1 - b.lugs.x0).toBeCloseTo(b.servo.lugSpan, 9)
      // The case is centred between the lugs
      expect(b.case.x0 - b.lugs.x0).toBeCloseTo(b.lugs.x1 - b.case.x1, 9)
      expect(b.case.x1 - b.case.x0).toBeCloseTo(b.servo.length, 9)
      expect(b.room).toBeGreaterThanOrEqual(b.need)
      expect(b.warnings).toEqual([])
    }
    expect(res.a.warnings.filter((w) => w.id.startsWith('bay-'))).toEqual([])
  })

  it('makes the mount plate: the bay width between the rib faces, with a cut-out for the case', () => {
    for (const b of res.a.bays) {
      const plate = res.parts.find((p) => p.name === b.name)
      expect(plate.group).toBe('servos')
      expect(plate.material).toBe('ply-birch')
      expect(plate.thickness).toBe(b.servo.plate)
      expect(plate.qty).toBe(2)
      const o = bounds(plate.outline)
      expect(o.w).toBeCloseTo(b.width, 9) // the gap between the rib faces
      expect(o.h).toBeCloseTo(b.plate.x1 - b.plate.x0, 9)
      const cut = bounds(plate.holes[0])
      expect(cut.w).toBeCloseTo(b.servo.width + 0.001, 9)
      expect(cut.h).toBeCloseTo(b.servo.length + 0.001, 9)
      // Centred across, and the lugs' span either side along it
      expect((cut.x0 + cut.x1) / 2).toBeCloseTo(o.w / 2, 9)
      expect(cut.y0 - o.y0).toBeCloseTo(b.case.x0 - b.plate.x0 - 0.0005, 9)
      // Four pilot holes, inside the plate and clear of the cut-out
      expect(plate.holes).toHaveLength(5)
      for (const h of plate.holes.slice(1)) {
        for (const pt of h) {
          expect(inside(plate.outline, pt)).toBe(true)
          expect(inside(plate.holes[0], pt)).toBe(false)
        }
      }
      expect(plate.notes.join(' ')).toContain('SB')
    }
    // Rib faces: the plate's length fits exactly between them
    expect(b1.plate.s1 - b1.plate.s0).toBeCloseTo(b1.sB - b1.sA - 0.002, 9)
  })

  it('cuts a lead hole through every rib from the bay in to the root, and none outboard', () => {
    const ribs = res.parts.filter((p) => p.group === 'ribs')
    for (const rib of ribs) {
      const want = res.a.bays.filter((b) => rib.s <= b.sA + 1e-6)
      const leads = rib.holes.filter((h) => bounds(h).w < 0.02 && bounds(h).w > 0.003)
      expect(leads, `${rib.name} at ${rib.s.toFixed(3)}`).toHaveLength(want.length)
    }
    // The outermost rib has none, the root rib has both
    expect(ribs.at(-1).holes).toHaveLength(0)
    expect(ribs[0].holes).toHaveLength(2)
    expect(ribs[0].notes.join(' ')).toContain('Lead holes for SB1, SB2')
    // A lead behind the spar, the outermost bay's nearest to it
    const rib = ribs[0]
    const sparBack = res.a.sparX(rib.s) + res.st.spar.capWidth / 2 - res.a.section(rib.s).xl
    const [h2, h1] = [...rib.holes].sort((p, q) => bounds(p).x0 - bounds(q).x0)
    expect(bounds(h1).x0).toBeGreaterThan(sparBack)
    expect(bounds(h2).w).toBeCloseTo(b2.lead.diameter, 3)
    expect(bounds(h2).x0).toBeLessThan(bounds(h1).x0)
  })

  it('checks each lead hole for rib material and keeps it clear of the others', () => {
    for (const rib of res.parts.filter((p) => p.group === 'ribs')) {
      const leads = rib.holes.filter((h) => bounds(h).w < 0.02)
      for (const h of leads) {
        for (const pt of h) expect(inside(rib.outline, pt), rib.name).toBe(true)
        const { below, above } = rimsOf(rib.outline, h)
        expect(below, `${rib.name} below`).toBeGreaterThanOrEqual(MIN_MATERIAL - 1e-4)
        expect(above, `${rib.name} above`).toBeGreaterThanOrEqual(MIN_MATERIAL - 1e-4)
      }
      for (let i = 0; i < leads.length; i++) {
        for (let j = i + 1; j < leads.length; j++) {
          const p = bounds(leads[i])
          const q = bounds(leads[j])
          expect(p.x1 <= q.x0 || q.x1 <= p.x0, `${rib.name} holes overlap`).toBe(true)
        }
      }
      // The label stays clear of them
      if (rib.label && leads.length) {
        for (const h of leads) {
          const b = bounds(h)
          expect(rib.label.u + 0.001 > b.x1 || rib.label.u < b.x0, `${rib.name} label`).toBe(true)
        }
      }
    }
  })

  it('says so when a rib is too thin for the lead hole, and leaves the hole out', () => {
    // A 3% section with thick cap strips: behind the spar the ribs are too shallow for a 6 mm hole
    // with material round it
    const thin = build({
      bays: noBays([flap]),
      wingEdit: (i) => {
        deepWing(i)
      },
      edit: (st) => (st.covering.capStripThickness = 0.004),
      airfoilThickness: 3,
    })
    expect(thin.a.bays[0].ok).toBe(true)
    expect(thin.warnings.join(' ')).toMatch(/SB1: no room for its lead hole in R\d/)
    const noRoom = thin.parts.filter((p) => p.group === 'ribs' && p.notes.some((n) => n.startsWith('No room for the 6 mm lead hole for SB1')))
    expect(noRoom.length).toBeGreaterThan(0)
    // Every hole that was cut has its material round it
    for (const p of thin.parts.filter((q) => q.group === 'ribs')) {
      for (const h of p.holes) for (const pt of h) expect(inside(p.outline, pt)).toBe(true)
    }
  })

  it('warns when the servo is too tall for the wing, and when the bay cannot be built', () => {
    const tall = build({
      bays: [{ surface: 1, class: 'standard' }, ...noBays([flap])],
      wingEdit: (i) => {
        // Chord enough for a standard servo between the spar and the hinge, not depth enough for its height
        i.rootChord = 0.3
        i.panels = normalisePanels([{ id: 1, length: 0.9, tipChord: 0.26, dihedral: 0 }])
        i.mass = 3
      },
    })
    expect(tall.a.bays[0].ok).toBe(true)
    expect(tall.a.bays[0].room).toBeLessThan(tall.a.bays[0].need)
    expect(tall.a.warnings.map((w) => w.message).join(' ')).toMatch(/Servo bay SB1 needs .* of depth/)
    // A hinge so far forward there's no room between it and the spar
    const forward = build({ surfaces: [{ ...aileron, hingeIn: 0.4, hingeOut: 0.4 }], bays: [] })
    expect(forward.a.bays[0]).toMatchObject({ ok: false, problem: 'forward' })
    expect(forward.a.warnings.map((w) => w.message).join(' ')).toMatch(/Servo bay SB1 isn't built: there's no room between the main spar and the hinge/)
    expect(forward.parts.some((p) => p.group === 'servos')).toBe(false)
  })

  it('has no bays, plates or lead holes where they are removed', () => {
    const none = build({ bays: noBays() })
    expect(none.a.bays).toEqual([])
    expect(none.parts.some((p) => p.group === 'servos')).toBe(false)
    expect(none.parts.filter((p) => p.group === 'ribs').every((p) => p.holes.length === 0)).toBe(true)
    expect(none.weight.servos).toBe(0)
    expect(none.a.relief).toEqual([])
  })

  it('adds a hatch part and two rails on a sheeted wing, and only then', () => {
    const open = build()
    expect(open.parts.some((p) => p.name.endsWith('-H'))).toBe(false)
    expect(open.cutList.some((c) => c.item.startsWith('Hatch rail'))).toBe(false)
    const sheeted = build({ edit: (st) => (st.covering.type = 'sheeted') })
    const hatches = sheeted.parts.filter((p) => p.name.endsWith('-H'))
    expect(hatches.map((p) => p.name)).toEqual(['SB1-H', 'SB2-H'])
    for (const h of hatches) {
      const bay = sheeted.a.bays.find((b) => `${b.name}-H` === h.name)
      expect(h.material).toBe(sheeted.st.covering.sheetMaterial)
      expect(h.thickness).toBe(sheeted.st.covering.sheetThickness)
      expect(bounds(h.outline).w).toBeCloseTo(bay.hatch.s1 - bay.hatch.s0, 9)
      expect(bounds(h.outline).h).toBeCloseTo(bay.hatch.x1 - bay.hatch.x0, 9)
    }
    const rails = sheeted.cutList.filter((c) => c.item.startsWith('Hatch rail'))
    expect(rails).toHaveLength(2)
    expect(rails[0]).toMatchObject({ qty: 4, material: 'spruce' })
    expect(rails[0].length).toBeCloseTo(sheeted.a.bays[0].hatch.s1 - sheeted.a.bays[0].hatch.s0, 9)
  })
})

describe('servo weight', () => {
  it('adds the servos and the plates to the wing weight', () => {
    const plain = build({ bays: noBays() })
    const res = build()
    // Each half wing has the two servos: 2 × 9 g, in a pair
    expect(res.weight.servos).toBeCloseTo(2 * 2 * SERVOS.micro.mass, 9)
    const right = build({ handedness: 'right' })
    expect(right.weight.servos).toBeCloseTo(2 * SERVOS.micro.mass, 9)
    // The plates are in the weight, by hand: area × thickness × density
    const plates = res.parts.filter((p) => p.group === 'servos')
    expect(plates).toHaveLength(2)
    const byHand = plates.reduce((m, p) => {
      const area = bounds(p.outline).w * bounds(p.outline).h - p.holes.reduce((s, h) => s + Math.abs(polygonArea(h)), 0)
      return m + area * p.thickness * 680 * p.qty
    }, 0)
    expect(res.weight.by.servos).toBeCloseTo(byHand, 9)
    // The rest is the ribs (lead holes take a little off them) and the extra ribs at each bay end
    const delta = res.weight.total - plain.weight.total
    expect(delta).toBeGreaterThan(res.weight.servos + byHand * 1.1 - 0.01)
    expect(delta).toBeLessThan(res.weight.servos + byHand * 1.1 + 0.035)
    expect(res.weight.total).toBeCloseTo(res.weight.bare + res.weight.covering + res.weight.servos, 9)
  })
})

describe('servo inertia relief', () => {
  const { a: base, perf } = build({ bays: noBays() })
  const sampler = base.sampler
  const ll = perf.spanwise.ll
  const CL = perf.spanwise.CLmax

  it('takes n times the weight off the shear inboard of the servo, and its moment off the bending', () => {
    // 50 g at 0.35 m, at 6 g: F = 6 × 0.05 × 9.81 = 2.943 N, and 1.0300 N·m at the root
    const plain = spanLoads(sampler, ll, CL, { mass: 3, n: 6 })
    const relieved = spanLoads(sampler, ll, CL, { mass: 3, n: 6, relief: [{ s: 0.35, mass: 0.05 }] })
    const F = 6 * 0.05 * G
    expect(F).toBeCloseTo(2.943, 2)
    for (let k = 0; k < plain.rows.length; k++) {
      const p = plain.rows[k]
      const r = relieved.rows[k]
      expect(r.w).toBe(p.w)
      if (p.s < 0.35) {
        expect(p.V - r.V).toBeCloseTo(F, 9)
        expect(p.M - r.M).toBeCloseTo(F * (0.35 - p.s), 9)
      } else {
        expect(r.V).toBe(p.V)
        expect(r.M).toBe(p.M)
      }
    }
    expect(plain.rows[0].M - relieved.rows[0].M).toBeCloseTo(1.03005, 2)
    // Two servos add
    const two = spanLoads(sampler, ll, CL, { mass: 3, n: 6, relief: [{ s: 0.35, mass: 0.05 }, { s: 0.7, mass: 0.02 }] })
    expect(plain.rows[0].M - two.rows[0].M).toBeCloseTo(6 * G * (0.05 * 0.35 + 0.02 * 0.7), 9)
    // The wing's lift is untouched
    expect(relieved.halfLift).toBe(plain.halfLift)
  })

  it('lowers the root bending moment by n x weight x station for each servo in the analysis', () => {
    const res = build()
    const n = res.st.loads.designG
    const byHand = res.a.relief.reduce((m, r) => m + n * r.mass * G * (r.s - res.a.rootS), 0)
    expect(res.a.relief).toHaveLength(2)
    expect(res.a.relief[0]).toMatchObject({ name: 'SB1', mass: SERVOS.micro.mass })
    const plain = build({ bays: noBays() })
    expect(plain.a.rootMoment - res.a.rootMoment).toBeCloseTo(byHand, 9)
    // Two 9 g servos a third of the way along each surface, at 6 g
    expect(byHand).toBeCloseTo(6 * 0.009 * G * (0.2 + (0.5 + 0.35 / 3)), 6)
    // Shear too, and the negative g case
    expect(plain.a.rootShear - res.a.rootShear).toBeCloseTo(6 * 2 * 0.009 * G, 9)
    const nn = res.st.loads.negativeG
    expect(Math.abs(plain.a.neg.rows[0].M) - Math.abs(res.a.neg.rows[0].M)).toBeCloseTo(nn * 0.009 * G * (0.2 + (0.5 + 0.35 / 3)), 9)
    // Easier on the spar, never harder: every margin is at least what it was
    const lowest = (r) => r.a.summary.modes.compression.ms
    expect(lowest(res)).toBeGreaterThan(lowest(plain))
    for (let k = 0; k < res.a.stations.length; k++) {
      expect(res.a.stations[k].M).toBeLessThanOrEqual(plain.a.stations[k].M + 1e-9)
    }
  })

  it('only counts the bays that are built', () => {
    // A surface that cannot be placed brings no servo and no relief
    const res = build({ surfaces: [{ ...aileron, panel: 99 }, flap] })
    expect(res.a.relief.map((r) => r.name)).toEqual(['SB1'])
  })
})

describe('servo bays in the exports and the 3D view', () => {
  const res = build({ edit: (st) => (st.covering.type = 'sheeted') })

  it('puts the plates and hatches in the parts DXF, and the bays on a plan layer', () => {
    const files = partsDxf(res.parts, { ...defaultExportOptions(), split: true }, 'wing')
    const servos = files.filter((f) => /servo/i.test(f.name))
    expect(servos.length).toBeGreaterThan(0)
    // Each plate is its outline, the case cut-out and four pilot holes, all on the cut layer
    expect(parseDxf(servos[0].text).polylines.filter((p) => p.layer === 'CUT').length).toBeGreaterThanOrEqual(6)
    // Off by choice
    const off = partsDxf(res.parts, { ...defaultExportOptions(), split: true, parts: { ...defaultExportOptions().parts, servos: false } }, 'wing')
    expect(off.some((f) => /servo/i.test(f.name))).toBe(false)
    // The plan has the hatch outlines, servo and lead route on the SERVO layer
    const plan = parseDxf(planDxf(res.a, res.st, res.parts, { handedness: 'right', format: 'polyline' }).text)
    expect(plan.layers).toContain('SERVO')
    const onServo = plan.polylines.filter((p) => p.layer === 'SERVO')
    // Per bay: hatch, lugs, case, lead route
    expect(onServo).toHaveLength(res.a.bays.length * 4)
    const b = res.a.bays[0]
    const widths = onServo.filter((p) => p.closed).map((p) => Math.max(...p.pts.map((q) => q[0])) - Math.min(...p.pts.map((q) => q[0])))
    expect(widths.some((w) => Math.abs(w - (b.hatch.s1 - b.hatch.s0) * 1000) < 0.1)).toBe(true)
    // Its name is engraved in strokes on the text layer, so there are more of them than without bays
    const bare = build({ bays: noBays(), edit: (st) => (st.covering.type = 'sheeted') })
    const bareText = parseDxf(planDxf(bare.a, bare.st, bare.parts, { handedness: 'right', format: 'polyline' }).text).polylines.filter((p) => p.layer === 'TEXT')
    expect(plan.polylines.filter((p) => p.layer === 'TEXT').length).toBeGreaterThan(bareText.length)
  })

  it('lists the plates and rails in the cut list CSV', () => {
    const csv = cutListCsv(res.parts, res.cutList)
    expect(csv).toContain('SB1,2,Birch aircraft plywood')
    expect(csv).toContain('SB2-H')
    expect(csv).toContain('Hatch rail, Servo bay SB1')
  })

  it('builds a servo and a mount plate in 3D, the servo standing inside the skins', () => {
    const m = wing3d(res.a, res.st, res.parts)
    expect(m.solids.filter((s) => s.kind === 'servo')).toHaveLength(2)
    expect(m.solids.filter((s) => s.kind === 'plate')).toHaveLength(2)
    for (const b of res.a.bays) {
      const box = servoBox(res.a, res.st, b)
      expect(box.top).toBeCloseTo(box.base + b.servo.height, 9)
      expect(box.top).toBeLessThanOrEqual(box.ceil + 1e-9)
    }
    const r = build({ bays: noBays() })
    const none = wing3d(r.a, r.st, r.parts)
    expect(none.solids.some((s) => s.kind === 'servo' || s.kind === 'plate')).toBe(false)
  })
})
