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
import { bayFrame, configureBay, linkOf, savedLink, servoChoices, servoFits, linkSummary, bayLinkages, linkageFit, ROD_OFF_SQUARE, DEFAULT_LINK, assemblyGeometry, hornOutline } from '../src/lib/bayLinkage.js'
import { wing3d, surfaceHeight } from '../src/lib/wing3d.js'
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
  const a = build([{ surface: 1 }])
  const b = a.bays[0]
  const f = bayFrame(a, b)

  it('puts the hinge on the centre line at the bay, with the faces either side', () => {
    expect(b.ok).toBe(true)
    // By default in line with the servo: on its side the output stands out from the case along
    // the span, and its arm swings along the chord from there
    expect(f.bayS).toBe(b.s)
    expect(f.s).toBe(f.inline)
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
    // The best pair uses the most travel of those that fit and keep the pushrod outside
    const fitting = c.matrix.cells.flat().filter((r) => r.ok && r.fits && r.outside)
    expect(c.result.travelNeeded).toBeCloseTo(Math.max(...fitting.map((r) => r.travelNeeded)), 9)
    expect(c.armHole).toBe(c.matrix.best.armHole)
    // Its arm points down, to the horn under the surface, and its hole stays outside the wing
    const pivot = assemblyGeometry(f, b.servo, c, c.armHole, c.hornHole, c.face).pivot
    expect(c.face).toBe('bottom')
    expect(c.result.points.arm[2]).toBeLessThan(pivot[2])
    expect(c.result.outside).toBe(true)
    expect(c.result.clear).toBeGreaterThanOrEqual(0)
    expect(linkSummary(b.servo, c)).toMatch(/›.*hole \d+ › Du-Bro/)
  })

  it('keeps chosen holes, and the top face turns the arm up', () => {
    const c = configureBay(f, b.servo, { ...DEFAULT_LINK, armHole: 0, hornHole: 0 })
    expect(c.armHole).toBe(0)
    expect(c.hornHole).toBe(0)
    const over = configureBay(f, b.servo, { ...DEFAULT_LINK, hornFace: 'top' })
    expect(over.result.ok).toBe(true)
    expect(over.result.points.horn[2]).toBeGreaterThan(f.hinge.point[2])
    expect(over.result.points.arm[2]).toBeGreaterThan(f.at.base)
  })

  it('ranks a pair whose arm hole goes inside the wing below one that stays out', () => {
    const c = configureBay(f, b.servo, linkOf(b))
    const cells = c.matrix.cells.flat().filter((r) => r.ok)
    // The inner holes on a micro arm can't clear the skin from a servo lying on it
    expect(cells.some((r) => !r.outside)).toBe(true)
    const best = c.matrix.cells[c.matrix.best.armHole][c.matrix.best.hornHole]
    expect(best.outside && best.fits).toBe(true)
  })

  it('draws the section at the horn, the bevel, and a horn on the surface with its holes over the hinge', () => {
    const o = f.outline
    // The fixed part runs from ahead of the servo to its hinge spar's rear face, the moving
    // surface from the apex on the centre line to the trailing edge
    expect(o.cut).toBeLessThan(f.at.x - b.servo.run / 2)
    expect(Math.max(...o.fixed.map((p) => p[0]))).toBeCloseTo(f.surface.faces.fixedRear(f.s), 9)
    expect(o.moving[0][0]).toBeCloseTo(f.surface.faces.apex(f.s), 9)
    const sec = a.section(f.s)
    expect(Math.max(...o.moving.map((p) => p[0]))).toBeCloseTo(sec.xl + sec.c, 4)
    // Each face starts behind the hinge, by the bevel
    expect(f.meet.top).toBeGreaterThan(0)
    expect(f.meet.bottom).toBeGreaterThan(0)
    for (const face of ['top', 'bottom']) {
      const c = configureBay(f, b.servo, { ...DEFAULT_LINK, hornFace: face })
      const horn = hornOutline(f, c.horn, face)
      const u = (p) => (p[0] - f.hinge.point[0]) * f.hornDir[0] + (p[1] - f.hinge.point[1]) * f.hornDir[1]
      // Its base wholly behind the bevel, on the surface
      for (const p of horn.slice(0, 5)) expect(u(p)).toBeGreaterThan(f.meet[face])
      // Its holes' column straddles the hinge line, as high as the horn
      const tipU = horn.slice(5, 7).map(u)
      expect(Math.min(...tipU)).toBeLessThan(0)
      expect(Math.max(...tipU)).toBeGreaterThan(0)
      const up = face === 'top' ? 1 : -1
      expect(up * (horn[5][2] - f.hinge.point[2])).toBeCloseTo(f.faces[face] + c.horn.height, 9)
      // The horn's holes lie on the hinge line, inside the horn
      const hole = c.result.points.horn
      expect(hole[0]).toBeGreaterThan(f.hinge.point[0] - 1e-3)
    }
  })

  it('tells which servos fit the bay\'s depth', () => {
    const choices = servoChoices(f, servoOptions(), 2)
    expect(choices.some((o) => o.fits)).toBe(true)
    // In a bay only 5 mm deep nothing fits, and the reason names both depths
    const tall = servoChoices({ ...f, room: 0.005 }, servoOptions(), 2)
    const no = tall.find((o) => !o.fits)
    expect(no.reason).toMatch(/^Too thick for the wing here: needs \d+ mm, has 5 mm$/)
    expect(servoFits({ room: 0.05 }, installedServo('micro')).ok).toBe(true)
  })
})

describe('a servo turned round or over', () => {
  it('still drives the surface, its arm out through the skin on the horn\'s face', () => {
    for (const pose of [{ rotate: true }, { flip: true }, { rotate: true, flip: true }]) {
      const a = build([{ surface: 1, ...pose }])
      const b = a.bays[0]
      const f = bayFrame(a, b)
      expect(f.pose).toMatchObject(pose)
      const c = configureBay(f, b.servo, linkOf(b))
      expect(c.result.ok, JSON.stringify(pose)).toBe(true)
      expect(c.result.fits && c.result.outside, JSON.stringify(pose)).toBe(true)
    }
  })
})

const yawOf = (l) => l.bay.servo.yaw ?? 0

describe("every bay's linkage, and its warnings", () => {
  it('lines the horn up with the servo by default, on a raked hinge too, so the pushrod runs in both their planes', () => {
    // An aileron whose hinge runs from 65% to 85% of the chord: about 12° to the span
    const raked = { ...newSurface('aileron', 1, 0.45, 0.85, 1), hingeIn: 0.65, hingeOut: 0.85 }
    for (const square of ['chord', 'hinge']) {
      const bay = { surface: 1, square }
      const s = defaultState()
      s.input.rootChord = 0.45
      s.input.panels = normalisePanels([{ id: 1, length: 0.9, tipChord: 0.4, dihedral: 0 }])
      const controls = { ...defaultControls(), surfaces: [raked], bays: [bay] }
      const airfoil = resolveAirfoil(s.airfoil)
      const g = wingGeometry({ ...s.input, mode: 'panels' })
      const planform = projectedSampler(wingSampler(s.input, airfoil.params.thickness))
      const perf = airfoilPerformance(airfoil, { mass: 2, area: g.projectedArea, chord: g.mac, wing: { planform, span: g.span, sweepCos: 1 } })
      const a = analyseStructure({ wing: s.input, airfoil, structure: defaultStructure(), mass: 2, spanwise: perf.spanwise, controls })
      const l = bayLinkages(a, controls).get(1)
      // The pushrod in the horn's plane, and in the arm's: along the servo's case in plan (exactly
      // at neutral; at the servo's midpoint the surface is turned a little, and on a raked hinge
      // that swings the horn's hole a touch along the span)
      expect(l.c.rodAngle, square).toBeLessThan(2)
      const geom = assemblyGeometry(l.frame, l.bay.servo, l.c, l.c.armHole, l.c.hornHole, l.c.face)
      const along = [Math.cos(yawOf(l)), Math.sin(yawOf(l))]
      const d = [geom.horn[0] - geom.pivot[0], geom.horn[1] - geom.pivot[1]]
      // At neutral, the horn's hole on the line from the arm's holes along the case, to 0.01 mm
      expect(Math.abs(d[0] * along[1] - d[1] * along[0]), square).toBeLessThan(1e-5)
      const yaw = l.bay.servo.yaw
      const rod = [l.c.result.points.horn[0] - l.c.result.points.arm[0], l.c.result.points.horn[1] - l.c.result.points.arm[1]]
      expect(Math.abs(Math.atan2(rod[1], rod[0]) - yaw), square).toBeLessThan(0.035)
      // Square to the chord, the horn is turned off square to the hinge by the rake; square to
      // the hinge, it isn't turned at all
      if (square === 'chord') expect(Math.abs(l.frame.hornAngle)).toBeGreaterThan(5)
      else expect(Math.abs(l.frame.hornAngle)).toBeLessThan(0.01)
      expect(l.warnings.map((w) => w.id)).not.toContain('linkage-square-1')
    }
  })

  it('runs the pushrod square to the horn by default, and warns when the horn is moved off it', () => {
    const controls = (link) => ({ ...defaultControls(), surfaces: [newSurface('aileron', 1, 0.45, 0.85, 1)], bays: [{ surface: 1, link }] })
    const a = build([{ surface: 1 }])
    const l = bayLinkages(a, controls(null)).get(1)
    expect(l.c.rodAngle).toBeLessThan(0.5)
    expect(l.warnings).toEqual([])
    // 60 mm along the hinge from in line, its turn left to line up: still in the horn's plane
    const lined = bayLinkages(a, controls({ hornAt: l.frame.inline - l.frame.surface.s0 + 0.06 })).get(1)
    expect(lined.c.rodAngle).toBeLessThan(2)
    // The horn kept square to the hinge: well off its plane
    const moved = bayLinkages(a, controls({ hornAt: l.frame.inline - l.frame.surface.s0 + 0.06, hornAngle: 0 })).get(1)
    expect(moved.c.rodAngle).toBeGreaterThan(ROD_OFF_SQUARE)
    expect(moved.warnings.map((w) => w.id)).toContain('linkage-square-1')
    // Turning the horn to meet it clears it
    const turned = bayLinkages(a, controls({ hornAt: l.frame.inline - l.frame.surface.s0 + 0.06, hornAngle: -moved.c.rodAngle })).get(1)
    const turnedOther = bayLinkages(a, controls({ hornAt: l.frame.inline - l.frame.surface.s0 + 0.06, hornAngle: moved.c.rodAngle })).get(1)
    expect(Math.min(turned.c.rodAngle, turnedOther.c.rodAngle)).toBeLessThan(1)
  })

  it('warns when the holes need more travel than the servo has', () => {
    const a = build([{ surface: 1 }])
    const controls = (link) => ({ ...defaultControls(), surfaces: [newSurface('aileron', 1, 0.45, 0.85, 1)], bays: [{ surface: 1, link }] })
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

describe('the arm and pushrod outside the wing', () => {
  const linked = (bay) => {
    const a = build([bay])
    const controls = { ...defaultControls(), surfaces: [newSurface('aileron', 1, 0.45, 0.85, 1)], bays: [bay] }
    return { a, controls, l: bayLinkages(a, controls).get(1) }
  }
  const ids = (l) => l.warnings.map((w) => w.id)

  it('brings the arm out through the hatch to a horn underneath, the pushrod outside the wing', () => {
    const { a, l } = linked({ surface: 1 })
    expect(ids(l)).toEqual([])
    expect(l.fit.slots).toHaveLength(1)
    const arm = l.fit.slots[0]
    expect(arm).toMatchObject({ what: 'arm', surface: 'bottom', hatch: true })
    // The pushrod is wholly under the lower skin
    const rod = l.solids.find((x) => x.kind === 'pushrod').rings.flat()
    for (const [x, s, z] of rod) expect(z).toBeLessThan(surfaceHeight(a, s, x, 'lower'))
  })

  it('puts the servo under the upper skin for a horn on top, its arm out through a slot in it', () => {
    const { a, l } = linked({ surface: 1, link: { hornFace: 'top' } })
    expect(ids(l)).toEqual([])
    expect(l.frame.box.base).toBeGreaterThan(l.frame.box.floor)
    const arm = l.fit.slots.find((q) => q.what === 'arm')
    expect(arm).toMatchObject({ surface: 'top', hatch: false })
    // A slot about the arm's width across the span, ahead of the hinge
    expect(arm.s1 - arm.s0).toBeLessThan(0.008)
    expect(arm.x1).toBeLessThan(l.frame.hinge.point[0])
    const rod = l.solids.find((x) => x.kind === 'pushrod').rings.flat()
    for (const [x, s, z] of rod) expect(z).toBeGreaterThan(surfaceHeight(a, s, x, 'upper'))
  })

  it("warns when the arm's hole goes inside the wing, the servo inset too far from the skin", () => {
    const deep = linked({ surface: 1, inset: 0.02 })
    expect(deep.l.frame.box.base).toBeGreaterThan(deep.l.frame.box.floor + 0.01)
    expect(ids(deep.l)).toContain('linkage-inside-1')
    expect(deep.l.fit.clashes).toContain('inside')
    expect(deep.l.warnings.find((w) => w.id === 'linkage-inside-1').message).toMatch(/nearer the bottom skin/)
  })

  it("keeps every servo's arm clear of the bay's ribs and their cap strips, its output either way", () => {
    for (const cls of ['sub-micro', 'micro', 'mini', 'standard', 'hitec-hs-5125mg', 'hitec-hs-645mg', 'futaba-s3150']) {
      for (const pose of [{}, { rotate: true }]) {
        const { a, l } = linked({ surface: 1, class: cls, ...pose })
        const tag = `${cls} ${JSON.stringify(pose)}`
        expect(l.fit.clashes, tag).not.toContain('rib')
        // The arm's plane, half its thickness either side, inside the cap strips' edges
        const g = assemblyGeometry(l.frame, l.bay.servo, l.c, l.c.armHole, l.c.hornHole, l.c.face)
        const cov = a.structure.covering
        const cap = (cov.capStripWidth - a.structure.ribs.thickness) / 2
        const halfT = 0.0015
        expect(g.pivot[1] - halfT, tag).toBeGreaterThan(l.bay.inner[0] + cap)
        expect(g.pivot[1] + halfT, tag).toBeLessThan(l.bay.inner[1] - cap)
      }
    }
  })

  it('warns when the pushrod rubs on the skin between the arm and the horn', () => {
    const { a, l } = linked({ surface: 1 })
    expect(linkageFit(a, l.bay, l.frame, l.c).clashes).toEqual([])
    // The same wing with a bulge in its lower surface between the servo and the hinge
    const x0 = l.c.result.points.arm[0] + 0.01
    const x1 = l.frame.hinge.point[0] - 0.01
    const bulged = {
      ...a,
      section: (s) => {
        const sec = a.section(s)
        return {
          ...sec,
          surf: (q) => {
            const f = sec.surf(q)
            const x = sec.xl + q * sec.c
            return x > x0 && x < x1 ? { ...f, lower: f.lower - 0.02 * Math.sin((Math.PI * (x - x0)) / (x1 - x0)) } : f
          },
        }
      },
    }
    const fit = linkageFit(bulged, l.bay, l.frame, l.c)
    expect(fit.clashes).toEqual(['rod'])
    expect(fit.warnings[0].message).toMatch(/pushrod rubs on the bottom skin/)
  })

  it('draws the arm, horn and pushrod as closed, named pieces, flagged where they clash', () => {
    for (const bay of [{ surface: 1 }, { surface: 1, inset: 0.02 }]) {
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
      expect(armClash).toBe(!!bay.inset)
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
