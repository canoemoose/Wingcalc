// Air brakes: placement, the box or frame built into the wing, clashes with the spar, the
// control surfaces and the servo bays, parts, weight, servo bays beside them, exports and 3D.
import { describe, it, expect } from 'vitest'
import { defaultState, migrate } from '../src/lib/projects.js'
import { resolveAirfoil, airfoilPerformance } from '../src/lib/airfoils.js'
import { wingGeometry } from '../src/lib/calc.js'
import { wingSampler, projectedSampler, normalisePanels } from '../src/lib/wing.js'
import { analyseStructure, defaultStructure } from '../src/lib/structure.js'
import { buildParts, bounds, polygonArea } from '../src/lib/ribs.js'
import { partsDxf, planDxf, parseDxf, cutListCsv, defaultExportOptions } from '../src/lib/dxf.js'
import { wing3d } from '../src/lib/wing3d.js'
import { planThumb } from '../src/lib/thumbnails.js'
import { newSurface, defaultControls } from '../src/lib/controlSurfaces.js'
import { SERVOS, bayOf, setBay, dropBay } from '../src/lib/servos.js'
import { BRAKE, BRAKE_TYPES, newBrake, brakeKey, resolveBrake, resolveBrakes, addBrake, brakeOutline, bladeXs, bladeSlots, brakeOpenings, MIN_BRAKE } from '../src/lib/airBrakes.js'

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

// A deep wing (one 0.9 m panel, 450 to 400 mm chord, 2 kg), so there's room behind the spar
const deepWing = (input) => {
  input.rootChord = 0.45
  input.panels = normalisePanels([{ id: 1, length: 0.9, tipChord: 0.4, dihedral: 0 }])
  input.mass = 2
}
const blade = { ...newBrake('blade', 1, 0.45, 1), x: 0.6 }
const spoiler = { ...newBrake('spoiler', 1, 0.7, 2), x: 0.6 }

function build({ brakes = [blade], surfaces = [], bays = [], edit = () => {}, wingEdit = deepWing, handedness = 'pair', airfoilThickness = null } = {}) {
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
  const controls = { ...defaultControls(), surfaces, brakes, bays }
  const airfoil = resolveAirfoil(s.airfoil)
  const g = wingGeometry({ ...s.input, mode: 'panels' })
  const planform = projectedSampler(wingSampler(s.input, airfoil.params.thickness))
  const perf = airfoilPerformance(airfoil, { mass: s.input.mass, area: g.projectedArea, chord: g.mac, wing: { planform, span: g.span, sweepCos: 1 } })
  const a = analyseStructure({ wing: s.input, airfoil, structure: st, mass: s.input.mass, spanwise: perf.spanwise, controls })
  return { a, st: a.structure, input: s.input, controls, ...buildParts(a, a.structure, { handedness }) }
}
const noBays = (list) => list.map((b) => ({ surface: brakeKey(b.id), enabled: false }))
const sampler = () => {
  const s = defaultState()
  deepWing(s.input)
  return wingSampler(s.input)
}
const messages = (res) => res.a.warnings.map((w) => w.message)

describe('placing air brakes', () => {
  it('puts the ribs a little further apart than the brake is long, centred where asked', () => {
    const sm = sampler()
    for (const b of [blade, spoiler]) {
      const r = resolveBrake(sm, b, 0.002)
      expect(r.ok).toBe(true)
      expect(r.s).toBeCloseTo(sm.ends[0].inner.s + b.at, 9)
      const clear = b.type === 'blade' ? BRAKE.clearBlade : BRAKE.clearSpoiler
      // The gap between the rib faces is the length and a clearance each end
      expect(r.sB - r.sA - 0.002).toBeCloseTo(b.length + 2 * clear, 9)
      expect(r.gap).toBeCloseTo(b.length + 2 * clear, 9)
      expect((r.sA + r.sB) / 2).toBeCloseTo(r.s, 9)
      // Its chord range is centred on its chord fraction, straight in plan
      const w = sm.at(r.s)
      expect((r.x0 + r.x1) / 2).toBeCloseTo(w.xl + b.x * w.c, 9)
      expect(r.x1 - r.x0).toBeCloseTo(b.chord, 9)
    }
  })

  it('names them root outward, and leaves out one whose ribs would sit on an earlier one', () => {
    const sm = sampler()
    const list = resolveBrakes(sm, [spoiler, blade, { ...blade, id: 3, at: 0.47 }])
    expect(list.map((r) => r.name)).toEqual(['AB1', 'AB2', 'AB3'])
    expect(list.map((r) => r.id)).toEqual([1, 3, 2])
    expect(list[0].label).toBe('Blade brake AB1')
    expect(list[2].label).toBe('Spoiler AB3')
    expect(list[1].problem).toBe('overlap')
    expect(list[1].ok).toBe(false)
    expect(list.filter((r) => r.ok).map((r) => r.id)).toEqual([1, 2])
  })

  it('gives a reason for one that cannot be placed', () => {
    const sm = sampler()
    expect(resolveBrake(sm, { ...blade, panel: 99 }).problem).toBe('panel')
    expect(resolveBrake(sm, { ...blade, at: 0.02 }).problem).toBe('span')
    expect(resolveBrake(sm, { ...blade, at: 0.88 }).problem).toBe('span')
    for (const bad of [{ length: 0.01 }, { length: NaN }, { x: 0 }, { x: 1 }, { chord: 0 }, { height: 0 }, { blades: 0 }, { blades: 2.5 }, { blades: 9 }, { at: null }]) {
      expect(resolveBrake(sm, { ...blade, ...bad }).problem, JSON.stringify(bad)).toBe('size')
    }
    expect(resolveBrake(sm, { ...spoiler, angle: 5 }).problem).toBe('size')
    expect(resolveBrake(sm, { ...spoiler, height: 0, blades: 0 }).ok).toBe(true)
    expect(MIN_BRAKE).toBeGreaterThan(0)
  })

  it('adds a brake near the middle of the panel, then beside it, and says when there is no room', () => {
    const sm = sampler()
    const first = addBrake(sm, [], 0)
    expect(first.brakes).toHaveLength(1)
    expect(first.brakes[0]).toMatchObject({ id: 1, type: 'blade', panel: 1 })
    expect(first.brakes[0].at).toBeCloseTo(0.45, 6)
    const second = addBrake(sm, first.brakes, 0, 'spoiler')
    expect(second.id).toBe(2)
    expect(second.brakes[1].type).toBe('spoiler')
    expect(resolveBrakes(sm, second.brakes).every((r) => r.ok)).toBe(true)
    // A long brake on a short panel doesn't fit anywhere
    const s = defaultState()
    s.input.panels = normalisePanels([{ id: 1, length: 0.08, tipChord: 0.2, dihedral: 0 }])
    expect(addBrake(wingSampler(s.input), [], 0)).toBeNull()
    expect(addBrake(sm, [], 5)).toBeNull()
  })

  it('draws a closed outline and the slots in the covering', () => {
    const [r] = resolveBrakes(sampler(), [blade])
    expect(brakeOutline({ ok: false })).toBeNull()
    const o = brakeOutline(r)
    expect(o).toHaveLength(4)
    expect(selfIntersects(o)).toBe(false)
    // A slot for each blade, evenly across the box, each as long as the blade and a hair wider
    const stacked = resolveBrakes(sampler(), [{ ...blade, blades: 3, chord: 0.06 }])[0]
    const xs = bladeXs(stacked)
    expect(xs).toHaveLength(3)
    expect(xs[1] - xs[0]).toBeCloseTo(0.02, 9)
    expect((xs[0] + xs[2]) / 2).toBeCloseTo(stacked.xc, 9)
    const slots = brakeOpenings(stacked)
    expect(slots).toHaveLength(3)
    expect(slots[0].s1 - slots[0].s0).toBeCloseTo(stacked.length + 2 * BRAKE.slot, 9)
    // A spoiler has the one opening, round its plate
    const sp = resolveBrakes(sampler(), [spoiler])[0]
    const [op] = brakeOpenings(sp)
    expect(brakeOpenings(sp)).toHaveLength(1)
    expect(op.x1 - op.x0).toBeCloseTo(sp.chord + 2 * BRAKE.slot, 9)
  })

  it('cuts lattice slots in a blade only if it is long and high enough, clear of its edges', () => {
    expect(bladeSlots(0.01, 0.02)).toEqual([])
    expect(bladeSlots(0.08, 0.008)).toEqual([])
    const slots = bladeSlots(0.08, 0.02)
    expect(slots.length).toBeGreaterThanOrEqual(3)
    for (const [u0, z0, u1, z1] of slots) {
      expect(u0).toBeGreaterThan(0.003)
      expect(u1).toBeLessThan(0.08 - 0.003)
      expect(z0).toBeGreaterThan(0.004)
      expect(z1).toBeLessThan(0.02 - 0.003)
    }
    // Centred
    expect(slots[0][0]).toBeCloseTo(0.08 - slots.at(-1)[2], 9)
  })
})

describe('air brakes saved with the wing', () => {
  it('start with none, and older saves migrate to that', () => {
    expect(defaultControls().brakes).toEqual([])
    const old = defaultState()
    delete old.input.controls.brakes
    expect(migrate(old).input.controls.brakes).toEqual([])
    const older = defaultState()
    delete older.input.controls
    expect(migrate(older).input.controls).toEqual(defaultControls())
    const kept = defaultState()
    kept.input.controls.brakes = [blade]
    expect(migrate(JSON.parse(JSON.stringify(kept))).input.controls.brakes).toEqual([blade])
    const junk = defaultState()
    junk.input.controls.brakes = 'many'
    expect(migrate(junk).input.controls.brakes).toEqual([])
  })

  it('names both kinds and keeps their bay settings apart from the control surfaces', () => {
    expect(Object.keys(BRAKE_TYPES)).toEqual(['blade', 'spoiler'])
    expect(brakeKey(3)).toBe('b3')
    const c = setBay(defaultControls(), brakeKey(1), { class: 'mini' })
    expect(c.bays).toEqual([{ surface: 'b1', class: 'mini' }])
    expect(bayOf(c, 1).class).toBeNull()
    expect(dropBay(c, brakeKey(1)).bays).toEqual([])
  })
})

describe('a blade brake built into the wing', () => {
  const res = build()
  const br = res.a.brakes[0]

  it('is built between two ribs that are hard points, with its box inside the section', () => {
    expect(res.a.brakes).toHaveLength(1)
    expect(br.ok).toBe(true)
    expect(br.name).toBe('AB1')
    for (const s of [br.sA, br.sB]) {
      const rib = res.a.ribs.find((r) => Math.abs(r.s - s) < 3e-3)
      expect(rib, `rib at ${s}`).toBeTruthy()
      expect(rib.kind).toBe('hard')
    }
    expect(br.room).toBeGreaterThanOrEqual(br.need)
    expect(br.need).toBeCloseTo(blade.height + 0.002, 9)
    expect(br.walls).toHaveLength(2)
    for (const w of br.walls) expect(w.height).toBeGreaterThanOrEqual(br.room - 1e-9)
    expect(br.warnings).toEqual([])
  })

  it('has a servo bay beside it by default, sharing the box rib, and none if switched off', () => {
    expect(res.a.bays).toHaveLength(1)
    const bay = res.a.bays[0]
    expect(bay.ok).toBe(true)
    expect(bay.brake).toBe(true)
    expect(bay.surface).toBe('b1')
    expect(bay.hostLabel).toBe('Blade brake AB1')
    expect(bay.sB).toBeCloseTo(br.sA, 9)
    expect(bay.beyond).toBe(false)
    // Its servo is in the weight and is relieved
    expect(res.a.relief).toHaveLength(1)
    const off = build({ bays: noBays([blade]) })
    expect(off.a.bays).toEqual([])
    expect(off.a.relief).toEqual([])
    // At a chosen place instead
    const at = build({ bays: [{ surface: 'b1', at: 0.2, class: 'mini' }] })
    expect(at.a.bays[0].s).toBeCloseTo(at.a.sampler.ends[0].inner.s + 0.2, 9)
    expect(at.a.bays[0].servo).toMatchObject({ ...SERVOS.mini, mounting: 'upright' })
  })

  it('puts the bay on the other side when the inboard one would run off the panel', () => {
    const near = { ...blade, at: 0.055 }
    const r = build({ brakes: [near] })
    const bay = r.a.bays[0]
    expect(bay.ok).toBe(true)
    expect(bay.sA).toBeCloseTo(r.a.brakes[0].sB, 9)
  })

  it('makes the box walls, the blade and its lattice slots as parts, and no spoiler parts', () => {
    const names = res.parts.filter((p) => p.group === 'brakes').map((p) => p.name)
    expect(names).toEqual(['AB1-F', 'AB1-R', 'AB1-B'])
    const wall = res.parts.find((p) => p.name === 'AB1-F')
    expect(wall.material).toBe('ply-birch')
    expect(wall.thickness).toBe(BRAKE.wall)
    expect(wall.qty).toBe(2)
    expect(bounds(wall.outline).w).toBeCloseTo(br.inner[1] - br.inner[0], 9)
    expect(bounds(wall.outline).h).toBeCloseTo(br.walls[0].height, 9)
    const b = res.parts.find((p) => p.name === 'AB1-B')
    expect(bounds(b.outline).w).toBeCloseTo(blade.length, 9)
    expect(bounds(b.outline).h).toBeCloseTo(blade.height, 9)
    expect(b.qty).toBe(2)
    expect(b.holes.length).toBeGreaterThan(0)
  })

  it('counts every blade, and both surfaces', () => {
    const lattice = build({
      brakes: [{ ...blade, blades: 3, chord: 0.06, surface: 'both', height: 0.01 }],
      wingEdit: (i) => {
        deepWing(i)
        i.rootChord = 0.55
        i.panels[0].tipChord = 0.5
      },
      airfoilThickness: 14,
    })
    const b = lattice.parts.find((p) => p.name === 'AB1-B')
    expect(b.qty).toBe(3 * 2 * 2)
    const m = wing3d(lattice.a, lattice.st, lattice.parts)
    expect(m.solids.filter((s) => s.kind === 'blade')).toHaveLength(6)
    const single = build({ handedness: 'right' })
    expect(single.parts.find((p) => p.name === 'AB1-B').qty).toBe(1)
  })

  it('warns where the blades do not fit, saying what to change, but still builds it', () => {
    const tall = build({ brakes: [{ ...blade, height: 0.05 }] })
    expect(tall.a.brakes[0].ok).toBe(true)
    expect(tall.a.brakes[0].room).toBeLessThan(tall.a.brakes[0].need)
    const w = messages(tall).find((m) => /AB1 needs/.test(m))
    expect(w).toMatch(/50\.0 mm high/)
    expect(w).toMatch(/use shorter blades/)
    expect(tall.parts.some((p) => p.name === 'AB1-B')).toBe(true)
    // Blades through both skins need twice the room
    const both = build({ brakes: [{ ...blade, surface: 'both', height: 0.02 }] })
    expect(both.a.brakes[0].need).toBeCloseTo(0.044, 9)
  })

  it('warns when the box crosses the main spar, or runs into the edge stock', () => {
    const onSpar = build({ brakes: [{ ...blade, x: 0.3 }] })
    expect(onSpar.a.brakes[0].ok).toBe(true)
    expect(messages(onSpar).find((m) => /AB1 crosses the main spar/.test(m))).toMatch(/back/)
    // Ahead of the spar is fine
    const ahead = build({ brakes: [{ ...blade, x: 0.12, chord: 0.02 }] })
    expect(messages(ahead).some((m) => /crosses the main spar/.test(m))).toBe(false)
    expect(messages(build({ brakes: [{ ...blade, x: 0.95, chord: 0.04 }] })).some((m) => /trailing edge stock/.test(m))).toBe(true)
    expect(messages(build({ brakes: [{ ...blade, x: 0.05 }] })).some((m) => /leading edge stock/.test(m))).toBe(true)
  })
})

describe('a spoiler built into the wing', () => {
  const res = build({ brakes: [spoiler] })
  const br = res.a.brakes[0]

  it('has a frame and a hinged plate, with its opening and hinge line, and no box walls', () => {
    expect(br.ok).toBe(true)
    expect(br.walls).toEqual([])
    expect(br.surfaces).toEqual(['upper'])
    expect(br.openings).toHaveLength(1)
    const names = res.parts.filter((p) => p.group === 'brakes').map((p) => p.name)
    expect(names).toEqual(['AB1-P', 'AB1-F'])
    const plate = res.parts.find((p) => p.name === 'AB1-P')
    expect(bounds(plate.outline).w).toBeCloseTo(spoiler.length, 9)
    expect(bounds(plate.outline).h).toBeCloseTo(spoiler.chord, 9)
    expect(plate.etch).toHaveLength(1)
    const frame = res.parts.find((p) => p.name === 'AB1-F')
    expect(bounds(frame.outline).w).toBeCloseTo(br.gap, 9)
    expect(frame.holes).toHaveLength(1)
    // The opening leaves ply all round, and takes the plate with a millimetre clear
    const hole = bounds(frame.holes[0])
    expect(hole.w).toBeCloseTo(spoiler.length + 2 * BRAKE.slot, 9)
    expect(hole.x0).toBeGreaterThan(0.004)
    expect(bounds(frame.outline).w - hole.x1).toBeGreaterThan(0.004)
    // Hinge tape in the cut list, along the plate
    const tape = res.cutList.find((c) => c.item.startsWith('Hinge tape'))
    expect(tape.length).toBeCloseTo(spoiler.length, 9)
    expect(tape.material).toBe('mylar')
  })

  it('shows the plate open in 3D', () => {
    const m = wing3d(res.a, res.st, res.parts)
    const plates = m.solids.filter((s) => s.kind === 'blade')
    expect(plates).toHaveLength(1)
    expect(m.solids.some((s) => s.kind === 'brakeBox')).toBe(false)
  })
})

describe('clashes with control surfaces and servo bays', () => {
  const aileron = newSurface('aileron', 1, 0.5, 0.85, 1)

  it('warns when the box runs into a control surface hinge spar alongside it', () => {
    const clash = build({ surfaces: [aileron], brakes: [{ ...blade, at: 0.6, x: 0.7 }] })
    expect(messages(clash).some((m) => /AB1 runs into the hinge spar of Aileron A1/.test(m))).toBe(true)
    // Forward of the hinge, or beside the surface, no complaint
    const fine = build({ surfaces: [aileron], brakes: [{ ...blade, at: 0.6, x: 0.55 }] })
    expect(messages(fine).some((m) => /hinge spar of/.test(m))).toBe(false)
    const clear = build({ surfaces: [aileron], brakes: [{ ...blade, at: 0.2, x: 0.7 }] })
    expect(messages(clear).some((m) => /hinge spar of/.test(m))).toBe(false)
  })

  it('numbers brake bays among the servo bays, root outward, and names the surface or brake they work', () => {
    const r = build({ surfaces: [aileron], brakes: [{ ...blade, at: 0.2 }] })
    expect(r.a.bays.map((b) => b.name)).toEqual(['SB1', 'SB2'])
    expect(r.a.bays.map((b) => b.hostLabel)).toEqual(['Blade brake AB1', 'Aileron A1'])
    const plate = r.parts.find((p) => p.name === 'SB1')
    expect(plate.notes[0]).toContain('Blade brake AB1')
  })

  it('warns when a brake sits where another bay or the leads from an outer bay would pass', () => {
    // The aileron's bay (a third of the way along it) is under a brake dropped on top of it
    const onBay = build({ surfaces: [aileron], brakes: [{ ...blade, at: 0.5 + 0.35 / 3, x: 0.4 }], bays: noBays([blade]) })
    expect(messages(onBay).some((m) => /AB1 is in the way of Servo bay SB1/.test(m))).toBe(true)
    // An inboard brake right behind the spar blocks the strip the leads of the outer bay take
    const leads = build({ surfaces: [aileron], brakes: [{ ...blade, at: 0.2, x: 0.34, chord: 0.03 }], bays: noBays([blade]) })
    expect(messages(leads).some((m) => /leads for Servo bay SB1 would run through Blade brake AB1/.test(m))).toBe(true)
    // Moved back, they're clear
    const back = build({ surfaces: [aileron], brakes: [{ ...blade, at: 0.2, x: 0.6 }], bays: noBays([blade]) })
    expect(messages(back).some((m) => /leads for/.test(m))).toBe(false)
  })

  it('does not build a brake whose ribs are on another, and says why', () => {
    const r = build({ brakes: [blade, { ...blade, id: 2, at: 0.48 }] })
    expect(r.a.brakes.filter((b) => b.ok)).toHaveLength(1)
    expect(messages(r).some((m) => /AB2 isn't built: its ribs would be on top of another air brake/.test(m))).toBe(true)
    expect(r.parts.filter((p) => p.group === 'brakes').every((p) => p.name.startsWith('AB1'))).toBe(true)
  })

  it('does not build one off the end of its panel', () => {
    const r = build({ brakes: [{ ...blade, at: 0.88 }] })
    expect(r.a.brakes[0].ok).toBe(false)
    expect(messages(r).some((m) => /AB1 isn't built: its ribs would run off its panel/.test(m))).toBe(true)
    expect(r.a.bays).toEqual([])
    expect(r.parts.some((p) => p.group === 'brakes')).toBe(false)
  })
})

describe('air brake parts', () => {
  const variants = [
    ['a single blade', build()],
    [
      'a lattice through both skins',
      build({
        brakes: [{ ...blade, blades: 3, chord: 0.06, surface: 'both', height: 0.01 }],
        airfoilThickness: 14,
        wingEdit: (i) => {
          deepWing(i)
          i.rootChord = 0.55
          i.panels[0].tipChord = 0.5
        },
      }),
    ],
    ['a spoiler', build({ brakes: [spoiler] })],
    [
      'both on a tapered, swept wing with perpendicular ribs',
      build({
        brakes: [{ ...blade, at: 0.25 }, { ...spoiler, at: 0.55 }],
        edit: (st) => {
          st.ribs.orientation = 'perpendicular'
          st.ribs.lightening = true
        },
        wingEdit: (input) => {
          input.rootChord = 0.4
          input.panels = normalisePanels([{ id: 1, length: 0.9, tipChord: 0.3, sweep: 0.05, dihedral: 3, washout: 1 }])
          input.mass = 2
        },
      }),
    ],
  ]
  it.each(variants)('makes closed, simple outlines with holes inside them for %s', (_, res) => {
    expect(res.skipped).toEqual([])
    const parts = res.parts.filter((p) => p.group === 'brakes')
    expect(parts.length).toBeGreaterThan(0)
    for (const p of parts) {
      expect(p.outline.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)), p.name).toBe(true)
      expect(selfIntersects(p.outline), p.name).toBe(false)
      expect(Math.abs(polygonArea(p.outline)), p.name).toBeGreaterThan(0)
      for (const h of p.holes) {
        expect(selfIntersects(h), `${p.name} hole`).toBe(false)
        for (const pt of h) expect(inside(p.outline, pt), `${p.name} hole`).toBe(true)
      }
    }
    // There's a rib at each end of every brake that's built
    for (const br of res.a.brakes.filter((b) => b.ok)) expect(res.a.ribs.some((r) => Math.abs(r.s - br.sA) < 3e-3)).toBe(true)
  })
})

describe('air brake weight', () => {
  it('adds the parts and the servo to the wing weight, by hand', () => {
    const none = build({ brakes: [] })
    const res = build()
    const parts = res.parts.filter((p) => p.group === 'brakes')
    const byHand = parts.reduce((m, p) => {
      const area = Math.abs(polygonArea(p.outline)) - p.holes.reduce((s, h) => s + Math.abs(polygonArea(h)), 0)
      return m + area * p.thickness * 680 * p.qty
    }, 0)
    expect(byHand).toBeGreaterThan(0)
    expect(res.weight.by.brakes).toBeCloseTo(byHand, 9)
    expect(none.weight.by.brakes).toBeUndefined()
    // The servo: one micro servo per half wing, in a pair
    expect(res.weight.servos).toBeCloseTo(2 * SERVOS.micro.mass, 9)
    const off = build({ bays: noBays([blade]) })
    expect(off.weight.servos).toBe(0)
    // The rest of the difference is the extra ribs and the plate, the lead holes taking a little off
    const delta = res.weight.total - none.weight.total
    expect(delta).toBeGreaterThan(res.weight.servos + byHand * 1.1)
    expect(delta).toBeLessThan(res.weight.servos + byHand * 1.1 + 0.05)
    expect(res.weight.total).toBeCloseTo(res.weight.bare + res.weight.covering + res.weight.servos, 9)
  })

  it('relieves the spar by the brake servo, like any other servo', () => {
    const plain = build({ brakes: [blade], bays: noBays([blade]) })
    const res = build()
    expect(res.a.rootMoment).toBeLessThan(plain.a.rootMoment)
  })
})

describe('air brakes in the exports, the 3D view and the thumbnails', () => {
  const res = build({ brakes: [blade, spoiler] })

  it('puts the parts in the parts DXF, switchable, and the box and openings on the plan layer', () => {
    const files = partsDxf(res.parts, { ...defaultExportOptions(), split: true }, 'wing')
    expect(files.some((f) => /brake/i.test(f.name))).toBe(true)
    const off = partsDxf(res.parts, { ...defaultExportOptions(), split: true, parts: { ...defaultExportOptions().parts, brakes: false } }, 'wing')
    expect(off.some((f) => /brake/i.test(f.name))).toBe(false)
    const plan = parseDxf(planDxf(res.a, res.st, res.parts, { handedness: 'right', format: 'polyline' }).text)
    expect(plan.layers).toContain('BRAKE')
    const onBrake = plan.polylines.filter((p) => p.layer === 'BRAKE')
    // Blade: box and one slot; spoiler: frame, hinge line and opening
    expect(onBrake).toHaveLength(2 + 3)
    expect(onBrake.filter((p) => p.closed)).toHaveLength(4)
    const none = build({ brakes: [] })
    expect(parseDxf(planDxf(none.a, none.st, none.parts, { handedness: 'right', format: 'polyline' }).text).layers).not.toContain('BRAKE')
  })

  it('lists the parts in the cut list CSV', () => {
    const csv = cutListCsv(res.parts, res.cutList)
    expect(csv).toContain('AB1-B,2,Birch aircraft plywood')
    expect(csv).toContain('AB2-P')
    expect(csv).toContain('Hinge tape, Spoiler AB2')
  })

  it('builds box walls, blades and a plate in 3D', () => {
    const m = wing3d(res.a, res.st, res.parts)
    expect(m.solids.filter((s) => s.kind === 'brakeBox')).toHaveLength(2)
    expect(m.solids.filter((s) => s.kind === 'blade')).toHaveLength(2)
    const none = build({ brakes: [] })
    const bare = wing3d(none.a, none.st, none.parts)
    expect(bare.solids.some((s) => s.kind === 'brakeBox' || s.kind === 'blade')).toBe(false)
  })

  it('draws the plan thumbnail with them', () => {
    const none = build({ brakes: [] })
    const withBrakes = planThumb(res.a, res.st, res.parts)
    const without = planThumb(none.a, none.st, none.parts)
    expect(withBrakes.lines.length).toBeGreaterThan(without.lines.length)
  })
})
