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
import { wing3d, servoBox, servoBayParts, sectionAt, insetHeight, stringerBox, plateSolid } from '../src/lib/wing3d.js'
import { newSurface, defaultControls, resolveSurfaces } from '../src/lib/controlSurfaces.js'
import { SERVOS, SERVO_CLASSES, SERVO_CLEARANCE, ARM_ROOM, PLATE_EDGE, defaultServoClass, bayOf, setBay, dropBay, placeBays, servoMasses, placeServo, partsExtent, partSlice, installedServo, HITEC, xRangeAt, cutBands, MIN_PLY, SCREW_ROOM } from '../src/lib/servos.js'
import { bayLinkages } from '../src/lib/bayLinkage.js'

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
    expect(bayOf(c, 7)).toEqual({ surface: 7, enabled: true, class: null, square: 'chord', rotate: false, flip: false, fore: null, inset: null, along: null, at: null, link: null })
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
    // Every servo lies on its side: an older save's mounting and quarter turn go
    saved.input.controls.bays = [{ surface: 1, class: 'mini', mounting: 'upright' }, { surface: 2, mounting: 'flat', quarterTurn: true }]
    const m = migrate(JSON.parse(JSON.stringify(saved))).input.controls
    expect(m.bays).toEqual([{ surface: 1, class: 'mini' }, { surface: 2 }])
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
    // On its side: as wide as its height
    // The servo and the arm on its output, with their clearance, and clear of the cap strips
    expect(b1.width).toBeCloseTo(b1.servo.bayWidth, 9)
    expect(b1.servo.bayWidth).toBeGreaterThanOrEqual(b1.servo.width + 2 * SERVO_CLEARANCE + 2 * ARM_ROOM - 1e-9)
    expect(b1.servo.width).toBeGreaterThanOrEqual(v.height)
    // The ribs' centres are half the gap and half a rib out from the centre
    expect(b1.sB - b1.sA).toBeCloseTo(b1.width + 0.002, 9)
    expect((b1.sA + b1.sB) / 2).toBeCloseTo(b1.s, 9)
    expect(b1.ok && b2.ok).toBe(true)
  })

  it('takes the class and position chosen, from the panel inner end', () => {
    const [b] = place([aileron], [{ surface: 1, class: 'standard', at: 0.6 }])
    expect(b.class).toBe('standard')
    expect(b.s).toBeCloseTo(0.6, 9)
    expect(b.width).toBeCloseTo(b.servo.bayWidth, 9)
    expect(b.servo.width).toBeGreaterThanOrEqual(SERVOS.standard.width)
  })

  it('centres a bay along, measured from its surface\'s inner end', () => {
    const row = resolveSurfaces(wing(), [aileron])[0]
    const [b] = place([aileron], [{ surface: 1, along: 0.05 }])
    expect(b.s).toBeCloseTo(row.s0 + 0.05, 9)
  })

  it('takes along over an older at when both are saved', () => {
    const row = resolveSurfaces(wing(), [aileron])[0]
    const [b] = place([aileron], [{ surface: 1, along: 0.05, at: 0.6 }])
    expect(b.s).toBeCloseTo(row.s0 + 0.05, 9)
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

  it("sits each tray between two of the wing's own ribs when the servo fits, with none between", () => {
    // Ribs up to 180 mm apart (none at a bay's centre) leave room for a micro servo and its arm in a
    // rib bay, so the tray uses the wing's ribs
    const wide = build({ edit: (st) => Object.assign(st.ribs, { spacing: 'uniform', pitch: 0.18 }) })
    for (const b of wide.a.bays) {
      expect(b.ok).toBe(true)
      expect(b.onRibs).toBe(true)
      for (const s of [b.sA, b.sB]) {
        const rib = wide.a.ribs.find((r) => Math.abs(r.s - s) < 1e-3)
        expect(rib, `rib at ${s}`).toBeTruthy()
      }
      // And no rib between them
      expect(wide.a.ribs.filter((r) => r.s > b.sA + 1e-3 && r.s < b.sB - 1e-3)).toHaveLength(0)
    }
    expect(wide.skipped).toEqual([])
  })

  it('gives a servo too wide for the rib spacing a pair of hard-point ribs of its own', () => {
    const close = build({
      bays: [{ surface: 1, class: 'standard' }, ...noBays([flap])],
      edit: (st) => Object.assign(st.ribs, { spacing: 'even', pitch: 0.02 }),
    })
    const b = close.a.bays[0]
    expect(b.onRibs).toBeFalsy()
    for (const s of [b.sA, b.sB]) expect(close.a.ribs.find((r) => Math.abs(r.s - s) < 1e-3)?.kind).toBe('hard')
    expect(close.a.ribs.filter((r) => r.s > b.sA + 1e-3 && r.s < b.sB - 1e-3)).toHaveLength(0)
  })

  it('lays the servo between the main spar and the hinge, deep enough', () => {
    for (const b of res.a.bays) {
      const sf = res.a.surfaces.find((r) => r.id === b.surface)
      // Lugs wholly between the spar's rear face and the fixed hinge spar's front face
      for (const s of [b.sA, b.sB]) {
        expect(b.plate.x1).toBeLessThan(sf.faces.fixedFront(s))
        expect(b.plate.x0).toBeGreaterThan(res.a.sparX(s))
      }
      // The run is the whole servo, lugs, boss and lead, at least its lugs' span
      expect(b.lugs.x1 - b.lugs.x0).toBeCloseTo(b.servo.run, 9)
      expect(b.servo.run).toBeGreaterThanOrEqual(b.servo.lugSpan)
      // The case is centred in it
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
      // The cut-out: what of the servo passes through the plate, half way up it on its side
      // (the case, its lugs on edge, the output boss and the lead's stub), and a slot where its arm
      // swings through the plate, each with the gap round it
      expect(b.cutRects).toHaveLength(b.servo.plan.rects.length + 1)
      const cut = bounds(plate.holes[0])
      expect(cut.w).toBeCloseTo(b.cut.s1 - b.cut.s0, 9)
      expect(cut.h).toBeCloseTo(b.cut.x1 - b.cut.x0, 9)
      expect(cut.h).toBeGreaterThan(b.servo.lugSpan)
      // Where the servo is across (from the bay's centre, not the plate's when the tray sits
      // between the wing's own ribs) and along, and at least the plate's edge of ply all round
      expect((cut.x0 + cut.x1) / 2).toBeCloseTo((b.cut.s0 + b.cut.s1) / 2 - b.plate.s0, 9)
      expect(Math.min(cut.x0 - o.x0, o.x1 - cut.x1, cut.y0 - o.y0, o.y1 - cut.y1)).toBeGreaterThanOrEqual(PLATE_EDGE - 1e-9)
      expect(cut.y0 - o.y0).toBeCloseTo(b.cut.x0 - b.plate.x0, 9)
      // On its side its lugs stand on edge, so no screws: the plate is a frame, and its note says
      // how to fix the servo
      expect(plate.holes).toHaveLength(1)
      expect(plate.notes.join(' ')).toMatch(/blocks/)
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
    // with at least the lead margin of material between the spar's notch and the nearer hole
    expect(bounds(h2).x0 - sparBack).toBeGreaterThanOrEqual(res.st.ribs.leadMargin - 2e-4)
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
          // the lead margin of material between them
          expect(Math.max(q.x0 - p.x1, p.x0 - q.x1), `${rib.name} holes too close`).toBeGreaterThanOrEqual(res.st.ribs.leadMargin - 2e-4)
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

  it("cuts the plate's hole to the servo's shape, half a millimetre clear, not to the box round it", () => {
    const area = (poly) => Math.abs(poly.reduce((t, p, i) => t + p[0] * poly[(i + 1) % poly.length][1] - poly[(i + 1) % poly.length][0] * p[1], 0)) / 2
    for (const [id, pose] of [['micro', {}], ['hitec-hs-5125mg', {}], ['hitec-hs-645mg', { rotate: true }], ['standard', { flip: true, yaw: 0.2 }]]) {
      const v = installedServo(id, 2, pose)
      const { cutPoly, cutRects, cut } = v.plan
      const tag = `${id} ${JSON.stringify(pose)}`
      // Each corner of the outline is a corner or an edge of one of the parts' cuts
      for (const [x, q] of cutPoly) {
        const onEdge = cutRects.some((r) => {
          const xs = r.map((c) => c[0] * Math.cos(-(v.yaw ?? 0)) - c[1] * Math.sin(-(v.yaw ?? 0)))
          const ss = r.map((c) => c[0] * Math.sin(-(v.yaw ?? 0)) + c[1] * Math.cos(-(v.yaw ?? 0)))
          const px = x * Math.cos(-(v.yaw ?? 0)) - q * Math.sin(-(v.yaw ?? 0))
          const ps = x * Math.sin(-(v.yaw ?? 0)) + q * Math.cos(-(v.yaw ?? 0))
          const [x0, x1, s0, s1] = [Math.min(...xs), Math.max(...xs), Math.min(...ss), Math.max(...ss)]
          const inside = px > x0 - 1e-9 && px < x1 + 1e-9 && ps > s0 - 1e-9 && ps < s1 + 1e-9
          return inside && Math.min(px - x0, x1 - px, ps - s0, s1 - ps) < 1e-9
        })
        expect(onEdge, tag).toBe(true)
      }
      // No bigger than the parts' cuts together, and smaller than the box round them where a boss,
      // lug or lead sticks out of the case
      const sum = cutRects.reduce((t, r) => t + area(r), 0)
      expect(area(cutPoly), tag).toBeLessThanOrEqual(sum + 1e-12)
      if (!pose.yaw) expect(area(cutPoly), tag).toBeLessThan((cut.x[1] - cut.x[0]) * (cut.s[1] - cut.s[0]) * 0.97)
    }
    // A micro servo on its side: its lugs stand on edge through the plate, so the hole is the
    // case's width (with the gap) except at the lugs' notches, not the lugs' span everywhere
    const m = installedServo('micro', 2).plan
    const xs = m.cutPoly.map((p) => p[0])
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0.03)
    expect(m.cutPoly.length).toBeGreaterThan(4)
  })

  it('puts the plate where the lead clears it, not half way up an ordinary servo where its lead leaves', () => {
    for (const id of ['micro', 'standard', 'hitec-hs-5125mg', 'hitec-hs-125mg', 'hitec-hs-85mg', 'futaba-s3150', 'hitec-hs-645mg']) {
      const v = installedServo(id, 2)
      const parts = placeServo(v, { x: 0, s: 0, base: 0 })
      const z0 = v.lugHeight + v.lugThickness
      const lead = parts.find((p) => p.kind === 'servoLead').box
      expect(lead.z[0] >= z0 + v.plate - 1e-9 || lead.z[1] <= z0 + 1e-9, id).toBe(true)
    }
    // A generic micro servo's lead leaves its end 5 to 7 mm up its 12.2 mm width, where the plate
    // half way up would be: it goes as near half way as clears it
    const m = installedServo('micro', 2)
    const z = m.lugHeight + m.lugThickness
    expect(Math.abs(z - m.height / 2)).toBeGreaterThan(0.0005)
    // A wing servo's plate is still on its flat lugs, with its screw holes
    const w = installedServo('hitec-hs-5125mg', 2)
    expect(w.plan.screws.length).toBeGreaterThanOrEqual(4)
  })

  it('leaves no sliver of ply narrower than MIN_PLY between notches in the cut-out', () => {
    // Two cuts with a 2 mm tooth of ply between them along s, and a 2 mm gap: both cut away
    const bands = cutBands([
      { x: [0, 0.02], s: [0, 0.02] },
      { x: [0.005, 0.01], s: [0.02, 0.022] },
      { x: [0, 0.02], s: [0.022, 0.03] },
      { x: [0, 0.004], s: [0.032, 0.04] },
    ])
    expect(bands.map((b) => [b.s, b.x])).toEqual([[[0, 0.03], [0, 0.02]], [[0.03, 0.032], [0, 0.004]], [[0.032, 0.04], [0, 0.004]]].map(([s, x]) => [s, x]).reduce((out, b) => {
      // (the last two merge: alike)
      const last = out.at(-1)
      if (last && last[1][0] === b[1][0] && last[1][1] === b[1][1] && last[0][1] === b[0][0]) last[0] = [last[0][0], b[0][1]]
      else out.push(b)
      return out
    }, []))
    // Every servo's plate, every way round: no band shorter than MIN_PLY sits narrower than both
    // its neighbours (a tooth of ply poking in)
    for (const id of ['micro', 'standard', 'hitec-hs-65mg', 'hitec-hs-5125mg', 'hitec-hs-645mg', 'futaba-s3150']) {
      for (const pose of [{}, { rotate: true }, { face: 'top' }, { flip: true, face: 'top' }]) {
        const b = installedServo(id, 2, pose).plan.bands
        for (let i = 1; i + 1 < b.length; i++) {
          if (b[i].s[1] - b[i].s[0] >= MIN_PLY) continue
          const tag = `${id} ${JSON.stringify(pose)} band ${i}`
          expect(b[i].x[1] >= Math.min(b[i - 1].x[1], b[i + 1].x[1]) - 1e-12, tag).toBe(true)
          expect(b[i].x[0] <= Math.max(b[i - 1].x[0], b[i + 1].x[0]) + 1e-12, tag).toBe(true)
        }
      }
    }
  })

  it('has the servo go into the plate from the side its arm faces, the plate on the far side of its lugs or screws', () => {
    for (const id of ['hitec-hs-5125mg', 'hitec-hs-125mg', 'hitec-d145sw']) {
      // Flat lugs: a horn underneath puts the plate on top of them (the servo goes in from below,
      // its lugs bearing on the plate's underside); a horn on top, under them
      const parts = (v) => placeServo({ ...v, lift: 0 }, { x: 0, s: 0, base: 0 })
      const below = installedServo(id, 2, { face: 'bottom' })
      const above = installedServo(id, 2, { face: 'top' })
      const flat = (v) => parts(v).filter((p) => p.kind === 'servo' && p.box && Math.abs(p.box.z[1] - p.box.z[0] - v.lugThickness) < 1e-6)
      const zb = below.lugHeight + below.lugThickness - below.lift
      const za = above.lugHeight + above.lugThickness - above.lift
      expect(Math.max(...flat(below).map((p) => p.box.z[1])), id).toBeCloseTo(zb, 9)
      expect(Math.min(...flat(above).map((p) => p.box.z[0])), id).toBeCloseTo(za + above.plate, 9)
      expect(below.plan.blocks, id).toEqual([])
    }
  })

  it('gives an ordinary servo blocks to screw to beside its lugs, glued to the plate on the arm side, clear of the servo', () => {
    for (const id of ['micro', 'mini', 'standard', 'hitec-hs-65mg', 'hitec-hs-645mg', 'hitec-hs-85mg']) {
      for (const face of ['bottom', 'top']) {
        const v = installedServo(id, 2, { face })
        const tag = `${id} ${face}`
        const blocks = v.plan.blocks
        expect(blocks.length, tag).toBe(2)
        const z = v.lugHeight + v.lugThickness - v.lift
        const parts = placeServo({ ...v, lift: 0, yaw: 0 }, { x: 0, s: 0, base: 0 })
        const kase = parts[0].box
        const screw = (kase.z[0] + kase.z[1]) / 2
        for (const k of blocks) {
          // Against the plate, on the arm's side of it, past the screw
          if (face === 'bottom') {
            expect(k.z[1], tag).toBeCloseTo(z, 9)
            expect(k.z[0], tag).toBeLessThan(screw)
          } else {
            expect(k.z[0], tag).toBeCloseTo(z + v.plate, 9)
            expect(k.z[1], tag).toBeGreaterThan(screw)
          }
          expect(k.screw[1], tag).toBeCloseTo(screw, 9)
          // Not through any of the servo's parts
          for (const p of parts) {
            const r = partsExtent([p])
            const hit = r.x[0] < k.x[1] - 1e-9 && r.x[1] > k.x[0] + 1e-9 && r.s[0] < k.s[1] - 1e-9 && r.s[1] > k.s[0] + 1e-9 && r.z[0] < k.z[1] - 1e-9 && r.z[1] > k.z[0] + 1e-9
            expect(hit, `${tag}: block through ${p.kind}`).toBe(false)
          }
        }
        // The plate clear of the screws, on the far side from the arm
        if (face === 'bottom') expect(z).toBeGreaterThanOrEqual(screw + SCREW_ROOM - 1e-9)
        else expect(z + v.plate).toBeLessThanOrEqual(screw - SCREW_ROOM + 1e-9)
      }
    }
    // In the cut list, and marked on the plate
    const r = build({ bays: [{ surface: aileron.id, class: 'micro' }, { surface: flap.id, enabled: false }] })
    const b = r.a.bays.find((x) => x.surface === aileron.id)
    const plate = r.parts.find((p) => p.name === b.name)
    expect(plate.etch).toHaveLength(2)
    expect(plate.notes.join(' ')).toMatch(/spruce blocks/)
    expect(r.cutList.some((x) => /Servo screw block/.test(x.item))).toBe(true)
    // And in 3D
    expect(wing3d(r.a, r.st, r.parts).solids.filter((x) => x.kind === 'servoBlock')).toHaveLength(2)
  })

  it('cuts a slot in the plate where the arm swings through it, so the arm clears it', () => {
    for (const [cls, link] of [['micro', null], ['hitec-hs-5125mg', null], ['standard', { hornFace: 'top' }], ['mini', { travel: 60 }]]) {
      const r = build({ bays: [{ surface: aileron.id, class: cls, ...(link ? { link } : {}) }, { surface: flap.id, enabled: false }] })
      const b = r.a.bays.find((x) => x.surface === aileron.id)
      const controls = { ...r.controls }
      const l = bayLinkages(r.a, controls).get(aileron.id)
      const { plate } = servoBayParts(r.a, r.st, b)
      const arm = l.solids.find((x) => x.kind === 'servoArm').rings.flat()
      // Every corner of the arm's bar within the plate's thickness is inside the cut-out
      for (const [x, s, z] of arm) {
        if (z < plate.z - 1e-9 || z > plate.z + plate.thickness + 1e-9) continue
        const inCut = b.cutRects.some((q) => {
          const xr = xRangeAt(q, s)
          return xr && x >= xr[0] - 1e-9 && x <= xr[1] + 1e-9
        })
        expect(inCut, `${cls}: arm at ${x}, ${s}, ${z}`).toBe(true)
      }
    }
  })

  it('builds a servo and a mount plate in 3D, the servo standing inside the skins', () => {
    const m = wing3d(res.a, res.st, res.parts)
    // Per bay: the case and its two lugs, the output boss and the lead; the plate as one solid
    // with its cut-out through it
    const n = res.a.bays.length
    expect(m.solids.filter((s) => s.kind === 'servo')).toHaveLength(3 * n)
    expect(m.solids.filter((s) => s.kind === 'servoOutput')).toHaveLength(n)
    expect(m.solids.filter((s) => s.kind === 'servoLead')).toHaveLength(n)
    expect(m.solids.filter((s) => s.kind === 'plate')).toHaveLength(n)
    // Its top covers the plate less the cut-out, no more and no less
    for (const b of res.a.bays) {
      const sol = plateSolid({ ...res.a, sampler: { at: (s) => ({ y: s, z: 0 }), reach: 10 } }, b.plate, b.cutPoly, 0, 0.002)
      const P = sol.positions
      const half = P.length / 6
      let top = 0
      for (let i = 0; i < sol.indices.length; i += 3) {
        const [u, v, w] = [sol.indices[i], sol.indices[i + 1], sol.indices[i + 2]]
        if (u < half || v < half || w < half) continue
        const q = (k) => [P[3 * k + 2], P[3 * k]]
        const [A, B, C] = [q(u), q(v), q(w)]
        top += Math.abs((B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0])) / 2
      }
      const hole = Math.abs(b.cutPoly.reduce((t, p, i) => t + p[0] * b.cutPoly[(i + 1) % b.cutPoly.length][1] - b.cutPoly[(i + 1) % b.cutPoly.length][0] * p[1], 0)) / 2
      // (to the 32-bit floats the mesh holds)
      expect(top).toBeCloseTo((b.plate.x1 - b.plate.x0) * (b.plate.s1 - b.plate.s0) - hole, 7)
    }
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

describe('a Hitec servo in its bay, drawn from its drawing', () => {
  const at = (b, base = 0) => ({ x: (b.case.x0 + b.case.x1) / 2, s: b.s, base })
  const boxes = (parts, kind) => parts.filter((p) => p.kind === kind && p.box).map((p) => p.box)

  it('lies on its side, its lugs at their height across the span and its output along it', () => {
    const res = build({ bays: [{ surface: aileron.id, class: 'hitec-hs-85mg' }, { surface: flap.id, enabled: false }] })
    const b = res.a.bays.find((x) => x.ok)
    const parts = placeServo(b.servo, at(b))
    const [kase, ...lugs] = boxes(parts, 'servo')
    // The case is the drawing's 29 by 13 by 29.4 mm, its height across the span centred on the
    // bay and its width standing up from the floor
    const h = 0.0294
    expect(kase.x[1] - kase.x[0]).toBeCloseTo(0.029, 9)
    expect(kase.s[0]).toBeCloseTo(b.s - h / 2, 9)
    expect(kase.s[1]).toBeCloseTo(b.s + h / 2, 9)
    expect(kase.z[0]).toBeCloseTo(0, 9)
    expect(kase.z[1]).toBeCloseTo(0.013, 9)
    expect(kase.x[0]).toBeCloseTo(b.case.x0, 9)
    // The lugs span their 39.8 mm about the case, inside the bay's run, 19.2 mm up the case
    // (across the span now), 2 mm thick
    const mid = (b.case.x0 + b.case.x1) / 2
    expect(Math.min(...lugs.map((l) => l.x[0]))).toBeCloseTo(mid - 0.0199, 9)
    expect(Math.max(...lugs.map((l) => l.x[1]))).toBeCloseTo(mid + 0.0199, 9)
    expect(mid - 0.0199).toBeGreaterThanOrEqual(b.lugs.x0 - 1e-9)
    expect(mid + 0.0199).toBeLessThanOrEqual(b.lugs.x1 + 1e-9)
    for (const l of lugs) {
      expect(l.s[0]).toBeCloseTo(b.s - h / 2 + 0.0192, 9)
      expect(l.s[1]).toBeCloseTo(b.s - h / 2 + 0.0212, 9)
    }
    // The output boss stands out of the case's top along the span, aft of centre, to the horn seat
    const out = parts.find((p) => p.kind === 'servoOutput').cylinder
    expect(out.axis).toBe('s')
    expect(out.from).toBeCloseTo(b.s - h / 2 + 0.0294, 9)
    expect(out.to).toBeCloseTo(b.s - h / 2 + 0.0335, 9)
    expect(out.x - mid).toBeCloseTo(0.00785, 9)
    expect(out.z).toBeCloseTo(0.0065, 9)
    // The lead leaves the aft end near the base (the inboard side)
    const lead = boxes(parts, 'servoLead')[0]
    expect(lead.x[0]).toBeCloseTo(kase.x[1], 9)
    expect((lead.s[0] + lead.s[1]) / 2).toBeCloseTo(b.s - h / 2 + 0.004, 9)
  })

  it('turns round and over: the output forward or aft, inboard or outboard, the case where it was', () => {
    const base = build({ bays: [{ surface: aileron.id, class: 'hitec-hs-125mg' }, { surface: flap.id, enabled: false }] })
    const b0 = base.a.bays.find((x) => x.ok)
    const out0 = placeServo(b0.servo, at(b0)).find((p) => p.kind === 'servoOutput').cylinder
    const mid = (b0.case.x0 + b0.case.x1) / 2
    // Unturned: the output aft of the case's centre and outboard of it
    expect(out0.x).toBeGreaterThan(mid)
    expect(out0.from).toBeGreaterThan(b0.s)
    for (const [pose, aft, outboard] of [[{ rotate: true }, false, false], [{ flip: true }, true, false], [{ rotate: true, flip: true }, false, true]]) {
      const res = build({ bays: [{ surface: aileron.id, class: 'hitec-hs-125mg', ...pose }, { surface: flap.id, enabled: false }] })
      const b = res.a.bays.find((x) => x.ok)
      const tag = JSON.stringify(pose)
      expect(b.servo, tag).toMatchObject(pose)
      // The same room, so the same bay
      expect(b.width, tag).toBeCloseTo(b0.width, 9)
      expect(b.case.x0, tag).toBeCloseTo(b0.case.x0, 9)
      const parts = placeServo(b.servo, at(b))
      const out = parts.find((p) => p.kind === 'servoOutput').cylinder
      expect(out.x > (b.case.x0 + b.case.x1) / 2, tag).toBe(aft)
      expect(out.from > b.s, tag).toBe(outboard)
      // Every part within the case's own height, base up
      for (const p of parts.filter((q) => q.box)) {
        expect(p.box.z[0], tag).toBeGreaterThanOrEqual(-1e-9)
        expect(p.box.z[1], tag).toBeLessThanOrEqual(b.servo.height + 1e-9)
      }
    }
  })

  it('gives a feather servo its gear tower, and lies a servo on its side across the span', () => {
    const res = build({ bays: [{ surface: aileron.id, class: 'hitec-hs-65mg' }, { surface: flap.id, enabled: false }] })
    const b = res.a.bays.find((x) => x.ok)
    const parts = placeServo(b.servo, at(b))
    const tower = parts.find((p) => p.kind === 'servo' && p.cylinder).cylinder
    // On its side the servo's height runs across the span: the tower from 20 to 26 mm of it
    expect(tower.axis).toBe('s')
    expect(tower.from - (b.s - 0.013)).toBeCloseTo(0.02, 9)
    expect(tower.to - (b.s - 0.013)).toBeCloseTo(0.026, 9)
    // and its width is the depth
    const kase = parts[0].box
    expect(kase.z).toEqual([0, 0.0116])
  })
})

describe('every servo fits its bay, nothing through anything, and the plate keeps its ply', () => {
  // A deep wing (500 to 450 mm chord, 16% thick) with a stringer top and bottom through the bays
  const big = (input) => {
    input.rootChord = 0.5
    input.panels = normalisePanels([{ id: 1, length: 1.0, tipChord: 0.45, dihedral: 0 }])
    input.mass = 3
  }
  const withStringers = (st) => {
    st.stringers = [{ id: 1, position: 0.45, surface: 'both', width: 0.003, height: 0.003, material: 'balsa-hard' }]
  }
  const ids = [...SERVO_CLASSES, ...HITEC.map((s) => s.id)]
  const eps = 1e-6
  // Do two ranges overlap by more than a hair?
  const over = (p, q) => Math.min(p[1], q[1]) - Math.max(p[0], q[0]) > 1e-6
  const ranges = (p) => partsExtent([p])
  // How far a point is outside a convex polygon (negative inside)
  const outside = (poly, [x, y]) => {
    let inside = true
    let d = Infinity
    for (let i = 0; i < poly.length; i++) {
      const [ax, ay] = poly[i]
      const [bx, by] = poly[(i + 1) % poly.length]
      const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)))
      d = Math.min(d, Math.hypot(x - ax - t * (bx - ax), y - ay - t * (by - ay)))
      if ((bx - ax) * (y - ay) - (by - ay) * (x - ax) < 0) inside = false
    }
    return inside ? -d : d
  }

  function check(res, b, tag) {
    const { a, st } = res
    expect(b.ok, `${tag}: ${b.problem}`).toBe(true)
    expect(b.room, `${tag}: room`).toBeGreaterThanOrEqual(b.need)
    const { parts, plate } = servoBayParts(a, st, b)
    const sf = a.surfaces.find((r) => r.id === b.surface)
    for (const s of [b.sA, b.s, b.sB]) {
      // The plate (and everything over it) between the spar and the fixed hinge spar
      expect(b.plate.x1, `${tag}: hinge`).toBeLessThan(sf.faces.fixedFront(s))
      expect(b.plate.x0, `${tag}: spar`).toBeGreaterThan(a.sparX(s))
    }
    for (const p of parts) {
      const r = ranges(p)
      const what = `${tag} ${p.kind}`
      // Between the rib faces, and over the plate's run along the chord
      expect(r.s[0], `${what}: inner rib`).toBeGreaterThanOrEqual(b.inner[0] - eps)
      expect(r.s[1], `${what}: outer rib`).toBeLessThanOrEqual(b.inner[1] + eps)
      expect(r.x[0], `${what}: front`).toBeGreaterThanOrEqual(b.plate.x0 - eps)
      expect(r.x[1], `${what}: rear`).toBeLessThanOrEqual(b.plate.x1 + eps)
      // Inside the skins and clear of the stringers wherever it is
      for (let i = 0; i <= 2; i++) {
        const s = r.s[0] + ((r.s[1] - r.s[0]) * i) / 2
        for (let k = 0; k <= 8; k++) {
          const x = r.x[0] + ((r.x[1] - r.x[0]) * k) / 8
          expect(r.z[0], `${what}: lower skin`).toBeGreaterThanOrEqual(insetHeight(a, st, s, x, 'lower') - 1e-5)
          expect(r.z[1], `${what}: upper skin`).toBeLessThanOrEqual(insetHeight(a, st, s, x, 'upper') + 1e-5)
        }
        for (const str of st.stringers) {
          for (const w of ['upper', 'lower']) {
            const sb = stringerBox(a, st, str, s, w)
            const xs = sb.map((q) => q[0])
            const hs = sb.map((q) => q[1])
            const hit = over(r.x, [Math.min(...xs), Math.max(...xs)]) && over(r.z, [Math.min(...hs), Math.max(...hs)])
            expect(hit, `${what}: through the ${w} stringer`).toBe(false)
          }
        }
      }
      // Not through the plate
      for (const q of plate.pieces) {
        if (!over(r.s, [q.s0, q.s1]) || !over(r.z, [plate.z, plate.z + plate.thickness])) continue
        // Where the part crosses the piece along the span, its slice against the piece's ply
        const lo = Math.max(r.s[0], q.s0)
        const hi = Math.min(r.s[1], q.s1)
        for (let i = 1; i < 8; i++) {
          const s = lo + ((hi - lo) * i) / 8
          const sl = partSlice(p, s)
          if (!sl) continue
          const xs = [Math.min(...sl.map((v) => v[0])), Math.max(...sl.map((v) => v[0]))]
          const zs = [Math.min(...sl.map((v) => v[1])), Math.max(...sl.map((v) => v[1]))]
          const hit = over(xs, q.x(s)) && over(zs, [plate.z, plate.z + plate.thickness])
          expect(hit, `${what}: through the plate`).toBe(false)
        }
      }
    }
    // The plate under the upper skin, and keeping its ply round the cut-out and the screws
    for (const q of plate.pieces) {
      for (const s of [q.s0, q.s1]) for (const x of q.x(s)) expect(plate.z + plate.thickness, `${tag}: plate top`).toBeLessThanOrEqual(insetHeight(a, st, s, x, 'upper') + 1e-5)
    }
    const part = res.parts.find((q) => q.name === b.name)
    const o = bounds(part.outline)
    const cut = b.cut ? bounds(part.holes[0]) : null
    const screws = b.cut ? part.holes.slice(1) : part.holes
    if (cut) expect(Math.min(cut.x0 - o.x0, o.x1 - cut.x1, cut.y0 - o.y0, o.y1 - cut.y1), `${tag}: ply round the cut-out`).toBeGreaterThanOrEqual(PLATE_EDGE - 1e-9)
    for (const h of screws) {
      const hb = bounds(h)
      const r = (hb.x1 - hb.x0) / 2
      const cx = (hb.x0 + hb.x1) / 2
      const cy = (hb.y0 + hb.y1) / 2
      expect(Math.min(cx - o.x0, o.x1 - cx, cy - o.y0, o.y1 - cy) - r, `${tag}: screw to the plate's edge`).toBeGreaterThanOrEqual(MIN_MATERIAL - 1e-9)
      // A millimetre of ply at least between the pilot hole and the cut-out
      if (cut) expect(outside(part.holes[0], [cx, cy]) - r, `${tag}: screw to the cut-out`).toBeGreaterThanOrEqual(0.001 - 1e-9)
    }
  }

  // On the lower skin (a bottom horn, the default), upside down under the upper skin (a top
  // horn), and turned round, inset from it
  for (const [label, set] of [['on the lower skin', {}], ['upside down under the upper skin', { flip: true, link: { hornFace: 'top' } }], ['turned round, inset 3 mm from the upper skin', { rotate: true, inset: 0.003, link: { hornFace: 'top' } }]]) {
    it(`fits every servo ${label}`, () => {
      for (const id of ids) {
        const res = build({ bays: [{ surface: aileron.id, class: id, ...set }, { surface: flap.id, enabled: false }], wingEdit: big, airfoilThickness: 16, edit: withStringers })
        const b = res.a.bays.find((x) => x.surface === aileron.id)
        check(res, b, `${id} ${label}`)
        const box = servoBox(res.a, res.st, b)
        const tall = Math.max(b.servo.height, b.servo.lugHeight + b.servo.lugThickness + b.servo.plate)
        if (!set.link) expect(box.base, id).toBeCloseTo(box.floor, 9)
        else expect(box.base + tall, id).toBeCloseTo(box.ceil - (set.inset ?? 0), 9)
      }
    })
  }

  // A raked aileron (hinge at 65% inboard, 85% out: about 12° to the span) and some servos of
  // each kind, square to the hinge, turned round or over too
  const raked = { ...aileron, hingeIn: 0.65, hingeOut: 0.85 }
  const someIds = ['micro', 'standard', 'hitec-hs-645mg', 'hitec-hs-85mg', 'hitec-hs-125mg', 'hitec-d89mw']
  for (const turn of [{ square: 'hinge' }, { square: 'hinge', rotate: true }, { square: 'hinge', flip: true }]) {
    it(`fits a servo square to the hinge${turn.rotate ? ', turned round' : turn.flip ? ', upside down' : ''}`, () => {
      for (const id of someIds) {
        const res = build({ surfaces: [raked, flap], bays: [{ surface: aileron.id, class: id, ...turn }, { surface: flap.id, enabled: false }], wingEdit: big, airfoilThickness: 16, edit: withStringers })
        const b = res.a.bays.find((x) => x.surface === aileron.id)
        if (b.problem === 'forward') continue
        check(res, b, `${id} ${JSON.stringify(turn)}`)
        // Turned as asked: its edges at the hinge's angle
        const sf = res.a.surfaces.find((x) => x.id === aileron.id)
        const [p0, p1, p2] = b.body
        const ang = Math.atan2(p1[1] - p0[1], p1[0] - p0[0])
        expect(Math.abs(Math.cos(ang + Math.atan(sf.slope))), `${id}: turned`).toBeCloseTo(1, 6)
        const v = installedServo(id, 3)
        expect(Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), `${id}: along`).toBeCloseTo(v.length, 9)
        expect(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]), `${id}: across`).toBeCloseTo(v.caseWidth, 9)
      }
    })
  }

  it('puts the servo where it is set along the chord, in mm or as a share of it, kept between the spar and the hinge spar', () => {
    const bay = (fore) => build({ bays: [{ surface: aileron.id, class: 'micro', fore }, { surface: flap.id, enabled: false }], wingEdit: big, airfoilThickness: 16 }).a
    const centre = (b) => (b.case.x0 + b.case.x1) / 2
    const pick = (a) => a.bays.find((x) => x.surface === aileron.id)
    const auto = pick(bay(null))
    // Too far forward: as far forward as it goes, and warned
    const front = pick(bay({ value: 0, by: 'length' }))
    expect(front.warnings.some((w) => /can't go 0\.0 mm from the leading edge/.test(w))).toBe(true)
    expect(centre(front)).toBeLessThanOrEqual(centre(auto) + 1e-9)
    // Too far back: as far back as it goes
    const back = pick(bay({ value: 1, by: 'chord' }))
    expect(centre(back)).toBeGreaterThan(centre(front))
    // Between them, where it's asked, by length or as a share of the chord at the bay
    const a = bay(null)
    const sec = a.section(auto.s)
    const x = (centre(front) + centre(back)) / 2
    const byLength = pick(bay({ value: x - sec.xl, by: 'length' }))
    expect(centre(byLength)).toBeCloseTo(x, 9)
    expect(byLength.warnings.filter((w) => /leading edge/.test(w))).toEqual([])
    const byChord = pick(bay({ value: (x - sec.xl) / sec.c, by: 'chord' }))
    expect(centre(byChord)).toBeCloseTo(x, 9)
  })

  it('screws a wing servo up into the plate by its flat lugs, and leaves an ordinary one to be fixed another way', () => {
    const at = (id) => build({ bays: [{ surface: aileron.id, class: id }, { surface: flap.id, enabled: false }], wingEdit: big, airfoilThickness: 16 }).a.bays.find((x) => x.surface === aileron.id)
    expect(at('hitec-hs-125mg').screws.length).toBeGreaterThanOrEqual(4)
    // On its side an ordinary servo's lugs stand on edge: none bears on the plate
    expect(at('hitec-hs-85mg').screws).toEqual([])
  })

  for (const [label, turn] of [['', {}], [', turned square to a raked hinge', { square: 'hinge' }], [', turned round and over', { rotate: true, flip: true }]]) it(`draws the servos and plates as closed solids, and fills them in the section cut${label}`, () => {
    const surfaces = [{ ...aileron, hingeIn: 0.65, hingeOut: 0.85 }, flap]
    const res = build({ surfaces, bays: [{ surface: aileron.id, class: 'hitec-hs-645mg', ...turn }, { surface: flap.id, class: 'hitec-hs-125mg', ...turn }], wingEdit: big, airfoilThickness: 16 })
    const m = wing3d(res.a, res.st, res.parts)
    const kinds = ['servo', 'servoOutput', 'servoLead', 'plate']
    const solids = m.solids.filter((s) => kinds.includes(s.kind))
    expect(solids.length).toBeGreaterThan(10)
    for (const sol of solids) {
      // Closed: every edge shared by exactly two triangles
      const edges = new Map()
      const idx = sol.indices
      for (let i = 0; i < idx.length; i += 3) {
        for (const [p, q] of [
          [idx[i], idx[i + 1]],
          [idx[i + 1], idx[i + 2]],
          [idx[i + 2], idx[i]],
        ]) {
          const k = p < q ? `${p},${q}` : `${q},${p}`
          edges.set(k, (edges.get(k) ?? 0) + 1)
        }
      }
      expect([...edges.values()].every((n) => n === 2), `${sol.kind} closed`).toBe(true)
    }
    // A cut through each bay's middle fills the servo and the plate
    for (const b of res.a.bays.filter((x) => x.ok)) {
      const got = new Set(sectionAt(res.a, res.st, res.parts, b.s).pieces.map((p) => p.kind))
      expect(got.has('servo'), b.name).toBe(true)
      expect(got.has('plate'), b.name).toBe(true)
    }
  })
})
