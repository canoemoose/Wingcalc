// A bay's linkage on a real wing: the frame a built bay gives the geometry, the defaults, the
// hole matrix, which servos fit, and the link saved with the bay.
import { describe, it, expect } from 'vitest'
import { defaultState } from '../src/lib/projects.js'
import { resolveAirfoil, airfoilPerformance } from '../src/lib/airfoils.js'
import { wingGeometry } from '../src/lib/calc.js'
import { wingSampler, projectedSampler, normalisePanels } from '../src/lib/wing.js'
import { analyseStructure, defaultStructure } from '../src/lib/structure.js'
import { newSurface, defaultControls } from '../src/lib/controlSurfaces.js'
import { bayOf, setBay, installedServo, servoOptions } from '../src/lib/servos.js'
import { bayFrame, configureBay, linkOf, savedLink, servoChoices, servoFits, linkSummary, bayLinkages, linkageFit, ROD_OFF_SQUARE, DEFAULT_LINK } from '../src/lib/bayLinkage.js'
import { wing3d } from '../src/lib/wing3d.js'
import { buildParts } from '../src/lib/ribs.js'

// A deep wing (one 0.9 m panel, 450 to 400 mm chord, 2 kg) with an aileron
function build(bays = []) {
  const s = defaultState()
  s.input.rootChord = 0.45
  s.input.panels = normalisePanels([{ id: 1, length: 0.9, tipChord: 0.4, dihedral: 0 }])
  s.input.mass = 2
  const st = defaultStructure()
  const controls = { ...defaultControls(), surfaces: [newSurface('aileron', 1, 0.45, 0.85, 1)], bays }
  const airfoil = resolveAirfoil(s.airfoil)
  const g = wingGeometry({ ...s.input, mode: 'panels' })
  const planform = projectedSampler(wingSampler(s.input, airfoil.params.thickness))
  const perf = airfoilPerformance(airfoil, { mass: s.input.mass, area: g.projectedArea, chord: g.mac, wing: { planform, span: g.span, sweepCos: 1 } })
  return analyseStructure({ wing: s.input, airfoil, structure: st, mass: s.input.mass, spanwise: perf.spanwise, controls })
}

describe('a bay\'s frame', () => {
  const a = build([{ surface: 1, mounting: 'side' }])
  const b = a.bays[0]
  const f = bayFrame(a, b)

  it('puts the hinge on the centre line at the bay, with the faces either side', () => {
    expect(b.ok).toBe(true)
    // By default square to the hinge from the servo's output: on its side the output stands
    // out from the case along the span
    expect(f.bayS).toBe(b.s)
    expect(f.s).toBe(f.square)
    expect(f.s).toBeGreaterThan(b.s)
    const at = bayFrame(a, b, { ...DEFAULT_LINK, hornAt: 0.1 })
    expect(at.s).toBeCloseTo(f.surface.s0 + 0.1, 9)
    // Kept on the surface, clear of its ends
    expect(bayFrame(a, b, { ...DEFAULT_LINK, hornAt: -1 }).s).toBeCloseTo(f.range[0], 9)
    expect(f.hinge.point[0]).toBeCloseTo(f.surface.hingeX(f.s), 9)
    expect(f.faces.top).toBeGreaterThan(0.002)
    expect(f.faces.top).toBeCloseTo(f.faces.bottom, 9)
    // 25% of a chord about 0.43 m
    expect(f.depth).toBeGreaterThan(0.09)
    expect(f.depth).toBeLessThan(0.12)
    expect(f.up).toBe(20)
    expect(f.down).toBe(15)
    // The servo ahead of the hinge
    expect(f.at.x).toBeLessThan(f.hinge.point[0])
  })

  it('solves the default link: the class\'s generic arm and horn, the best holes', () => {
    const c = configureBay(f, b.servo, linkOf(b))
    expect(c.arm.maker).toBe('Generic')
    // 2 kg takes a micro servo, and a micro horn
    expect(b.servo.class ?? b.class).toBe('micro')
    expect(c.horn.id).toBe('du-bro-848')
    expect(c.result.ok).toBe(true)
    expect(c.result.fits).toBe(true)
    // The best pair uses the most travel of those that fit
    const fitting = c.matrix.cells.flat().filter((r) => r.ok && r.fits)
    expect(c.result.travelNeeded).toBeCloseTo(Math.max(...fitting.map((r) => r.travelNeeded)), 9)
    expect(c.armHole).toBe(c.matrix.best.armHole)
    // Its arm points up, towards the top horn
    expect(c.result.points.arm[2]).toBeGreaterThan(f.hinge.point[2] - 0.02)
    expect(linkSummary(b.servo, c)).toMatch(/›.*hole \d+ › Du-Bro/)
  })

  it('keeps chosen holes, and the bottom face turns the arm down', () => {
    const c = configureBay(f, b.servo, { ...DEFAULT_LINK, armHole: 0, hornHole: 0 })
    expect(c.armHole).toBe(0)
    expect(c.hornHole).toBe(0)
    const under = configureBay(f, b.servo, { ...DEFAULT_LINK, hornFace: 'bottom' })
    expect(under.result.ok).toBe(true)
    expect(under.result.points.horn[2]).toBeLessThan(f.hinge.point[2])
  })

  it('tells which servos fit the bay\'s depth', () => {
    const choices = servoChoices(f, servoOptions(), 'side', 2)
    expect(choices.some((o) => o.fits)).toBe(true)
    // Upright, a standard servo is too tall for a 12% wing's aileron bay... or it fits: either
    // way the reason names both depths
    const tall = servoChoices({ ...f, room: 0.01 }, servoOptions(), 'upright', 2)
    const no = tall.find((o) => !o.fits)
    expect(no.reason).toMatch(/^Needs \d+ mm of depth, the bay has 10 mm$/)
    expect(servoFits({ room: 0.05 }, installedServo('micro')).ok).toBe(true)
  })
})

describe('an upright servo', () => {
  it('solves with its arm swinging level', () => {
    const a = build()
    const f = bayFrame(a, a.bays[0])
    const c = configureBay(f, a.bays[0].servo, DEFAULT_LINK)
    expect(c.result.ok).toBe(true)
    expect(c.result.fits).toBe(true)
    // The arm's hole stays at the pivot's height: it swings in the wing's plane
    const g = c.result.points.arm
    expect(g[2]).toBeCloseTo(f.at.base + a.bays[0].servo.lift + a.bays[0].servo.frame.output.top + c.arm.seat, 9)
  })
})

describe("every bay's linkage, and its warnings", () => {
  it('runs the pushrod square to the horn by default, and warns when the horn is moved off it', () => {
    const controls = (link) => ({ ...defaultControls(), surfaces: [newSurface('aileron', 1, 0.45, 0.85, 1)], bays: [{ surface: 1, mounting: 'side', link }] })
    const a = build([{ surface: 1, mounting: 'side' }])
    const l = bayLinkages(a, controls(null)).get(1)
    expect(l.c.rodAngle).toBeLessThan(1)
    expect(l.warnings).toEqual([])
    // 60 mm along the hinge from square: well off the horn's plane
    const moved = bayLinkages(a, controls({ hornAt: l.frame.square - l.frame.surface.s0 + 0.06 })).get(1)
    expect(moved.c.rodAngle).toBeGreaterThan(ROD_OFF_SQUARE)
    expect(moved.warnings.map((w) => w.id)).toContain('linkage-square-1')
    // Turning the horn to meet it clears it
    const turned = bayLinkages(a, controls({ hornAt: l.frame.square - l.frame.surface.s0 + 0.06, hornAngle: -moved.c.rodAngle })).get(1)
    const turnedOther = bayLinkages(a, controls({ hornAt: l.frame.square - l.frame.surface.s0 + 0.06, hornAngle: moved.c.rodAngle })).get(1)
    expect(Math.min(turned.c.rodAngle, turnedOther.c.rodAngle)).toBeLessThan(1)
  })

  it('warns when the holes need more travel than the servo has', () => {
    const a = build([{ surface: 1, mounting: 'side' }])
    const controls = (link) => ({ ...defaultControls(), surfaces: [newSurface('aileron', 1, 0.45, 0.85, 1)], bays: [{ surface: 1, mounting: 'side', link }] })
    // A pair that doesn't fit within ±45°
    const { cells } = bayLinkages(a, controls(null)).get(1).c.matrix
    let pair = null
    cells.forEach((row, i) => row.forEach((r, j) => (pair ??= r.ok && !r.fits ? { armHole: i, hornHole: j } : null)))
    expect(pair).not.toBeNull()
    const l = bayLinkages(a, controls(pair)).get(1)
    expect(l.warnings.map((w) => w.id)).toContain('linkage-travel-1')
    expect(l.warnings[0].message).toMatch(/more than its ±45°/)
  })
})

describe('the arm and pushrod in the wing', () => {
  const linked = (bay) => {
    const a = build([bay])
    const controls = { ...defaultControls(), surfaces: [newSurface('aileron', 1, 0.45, 0.85, 1)], bays: [bay] }
    return { a, controls, l: bayLinkages(a, controls).get(1) }
  }
  const ids = (l) => l.warnings.map((w) => w.id)

  it('lets the pushrod out through a slot in the top skin, ahead of the hinge spar, from a servo on its side', () => {
    const { l } = linked({ surface: 1, mounting: 'side' })
    expect(ids(l)).toEqual([])
    const rod = l.fit.slots.filter((q) => q.what === 'pushrod')
    expect(rod).toHaveLength(1)
    expect(rod[0].surface).toBe('top')
    expect(rod[0].hatch).toBe(false)
    // A slot a few millimetres wide, ahead of the hinge
    expect(rod[0].s1 - rod[0].s0).toBeLessThan(0.006)
    expect(rod[0].x1 - rod[0].x0).toBeGreaterThan(0.003)
    expect(rod[0].x1).toBeLessThan(l.frame.hinge.point[0])
  })

  it('takes the arm and pushrod out through the hatch to a horn underneath', () => {
    const { l } = linked({ surface: 1, mounting: 'side', link: { hornFace: 'bottom' } })
    expect(ids(l)).toEqual([])
    const arm = l.fit.slots.find((q) => q.what === 'arm')
    expect(arm.surface).toBe('bottom')
    expect(arm.hatch).toBe(true)
  })

  it('warns when an upright arm sweeps into the ribs, or through the top skin', () => {
    expect(ids(linked({ surface: 1 }).l)).toContain('linkage-rib-1')
    const tall = linked({ surface: 1, class: 'standard' }).l
    expect(ids(tall)).toContain('linkage-arm-top-1')
    expect(tall.fit.slots.some((q) => q.what === 'arm' && q.surface === 'top' && !q.hatch)).toBe(true)
  })

  it('warns when the pushrod is still inside the wing at the fixed hinge spar', () => {
    const { a, l } = linked({ surface: 1, mounting: 'side' })
    expect(l.fit.clashes).not.toContain('spar')
    // The same linkage with the spar's front face 50 mm ahead of the hinge
    const surface = { ...l.frame.surface, faces: { ...l.frame.surface.faces, fixedFront: (q) => l.frame.surface.hingeX(q) - 0.05 } }
    const fit = linkageFit(a, l.bay, { ...l.frame, surface }, l.c, l.link)
    expect(fit.clashes).toContain('spar')
    expect(fit.warnings.map((w) => w.id)).toContain('linkage-spar-1')
  })

  it('draws the arm, horn and pushrod as closed, named pieces, flagged where they clash', () => {
    for (const bay of [{ surface: 1, mounting: 'side' }, { surface: 1, class: 'standard' }]) {
      const { a, controls } = linked(bay)
      const links = bayLinkages(a, controls)
      const { parts } = buildParts(a, a.structure)
      const m = wing3d(a, a.structure, parts, links)
      const sol = m.solids.filter((x) => ['servoArm', 'horn', 'pushrod'].includes(x.kind))
      expect(sol.map((x) => x.kind).sort()).toEqual(['horn', 'pushrod', 'servoArm'])
      for (const x of sol) {
        expect(x.piece.id).toBe(`${x.kind}-SB1`)
        expect(x.pick).toBeUndefined()
        const edges = new Map()
        for (let i = 0; i < x.indices.length; i += 3) {
          for (const [p, q] of [[x.indices[i], x.indices[i + 1]], [x.indices[i + 1], x.indices[i + 2]], [x.indices[i + 2], x.indices[i]]]) {
            const k = p < q ? `${p},${q}` : `${q},${p}`
            edges.set(k, (edges.get(k) ?? 0) + 1)
          }
        }
        expect([...edges.values()].every((n) => n === 2), `${x.kind} closed`).toBe(true)
      }
      const armClash = !!sol.find((x) => x.kind === 'servoArm').clash
      expect(armClash).toBe(bay.class === 'standard')
    }
  })
})

describe('the link as saved', () => {
  it('keeps only what differs from the defaults, with the bay', () => {
    expect(savedLink(DEFAULT_LINK)).toBeNull()
    expect(savedLink({ ...DEFAULT_LINK, travel: 60, horn: 'du-bro-105' })).toEqual({ travel: 60, horn: 'du-bro-105' })
    const c = setBay(defaultControls(), 1, { link: { travel: 60 } })
    expect(c.bays).toEqual([{ surface: 1, link: { travel: 60 } }])
    expect(linkOf(bayOf(c, 1)).travel).toBe(60)
    expect(setBay(c, 1, { link: null }).bays).toEqual([])
  })
})
