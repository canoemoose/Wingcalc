// The linkage geometry: hole positions as installed, the closed-form joint equations, the
// midpoint and travel for the designed throws, and the mirrored half. Hand-worked cases are a
// parallelogram (arm and horn the same length: the surface follows the arm one for one) and a
// half-length arm (twice the servo angle, less what the sine takes).
import { describe, it, expect } from 'vitest'
import { linkage, solveAssembly, mirrorGeometry, outputPivot, hingeAt, hornHole, splineError, ARMS, HORNS } from '../src/lib/linkage.js'
import { installedServo, placeServo, turnPoint } from '../src/lib/servos.js'

const RAD = Math.PI / 180
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

// A servo on its side 100 mm ahead of the hinge, arm swinging in the chord's plane, the horn's
// hole 15 mm above the hinge on the centre line. The arm's pivot sits `drop` below the horn's
// hole so that at the midpoint the arm's hole is level with it.
const planar = (radius, drop = radius) => ({
  pivot: [-0.1, 0, 0.015 - drop],
  axis: [0, 1, 0],
  ref: [1, 0, 0],
  radius,
  hinge: { point: [0, 0, 0], axis: [0, 1, 0] },
  horn: [0, 0, 0.015],
})

// Of the two ways the arm can face, the one pointing up (its hole above the pivot)
const upward = (geom, opts) => [1, -1].map((facing) => solveAssembly(geom, { ...opts, facing })).find((r) => r.ok && r.points.arm[2] > geom.pivot[2])

describe('a parallelogram linkage', () => {
  const geom = planar(0.015)

  it('turns the surface one for one, square at neutral', () => {
    const r = upward(geom, { up: 20, down: 20, travel: 45, depth: 0.05 })
    expect(r.ok).toBe(true)
    expect(r.pushrod).toBeCloseTo(0.1, 9)
    expect(r.surfaceAtMid).toBeCloseTo(0, 6)
    expect(r.travelNeeded).toBeCloseTo(20, 6)
    expect(r.neutralArm).toBeCloseTo(0, 6)
    expect(r.advantage).toBeCloseTo(1, 4)
    expect(r.armSquare).toBeCloseTo(0, 6)
    expect(r.hornSquare).toBeCloseTo(0, 6)
    expect(r.fits).toBe(true)
    expect(r.achieved.up).toBeCloseTo(20, 6)
    expect(r.achieved.down).toBeCloseTo(20, 6)
    // 50 mm deep: 50 sin 20° at the trailing edge
    expect(r.achieved.downMm).toBeCloseTo(0.05 * Math.sin(20 * RAD), 9)
    expect(r.fullTravel.up).toBeCloseTo(45, 4)
    expect(r.surfaceAt(10)).toBeCloseTo(10, 6)
  })

  it('reaches only as far as the travel allows, and says so', () => {
    const r = upward(geom, { up: 50, down: 50, travel: 45 })
    expect(r.travelNeeded).toBeCloseTo(50, 6)
    expect(r.fits).toBe(false)
    expect(r.achieved.up).toBeCloseTo(45, 4)
    expect(r.achieved.down).toBeCloseTo(45, 4)
    // Extended end points cover it
    const x = upward(geom, { up: 50, down: 50, travel: 60 })
    expect(x.fits).toBe(true)
    expect(x.achieved.up).toBeCloseTo(50, 4)
  })
})

describe('a half-length arm', () => {
  // Arm 7.5 mm, horn 15 mm: r sin θ = h sin δ near enough with a long pushrod
  const geom = planar(0.0075)

  it('needs about twice the servo angle, and holds twice the hinge moment', () => {
    const r = upward(geom, { up: 20, down: 20, travel: 60 })
    expect(r.ok).toBe(true)
    const byHand = Math.asin(2 * Math.sin(20 * RAD)) / RAD // 43.2°
    expect(Math.abs(r.travelNeeded - byHand)).toBeLessThan(0.5)
    expect(Math.abs(r.advantage - 2)).toBeLessThan(0.04)
    expect(r.fits).toBe(true)
    expect(upward(geom, { up: 20, down: 20, travel: 45 }).fits).toBe(true)
  })

  it('keeps the pushrod its length at every angle (the closed form)', () => {
    const r = upward(geom, { up: 15, down: 25, travel: 60 })
    const L = linkage(geom)
    for (const servo of [-40, -25, -10, 0, 12, 33, 45]) {
      const d = r.surfaceAt(servo)
      const arm = L.arm((r.midpoint + r.direction * servo) * RAD)
      expect(dist(arm, L.hornAt(d * RAD))).toBeCloseTo(r.pushrod, 9)
    }
  })

  it("can't reach a throw past dead centre", () => {
    // A 4 mm arm can't move a 15 mm horn 20° (it would need sin θ > 1)
    const r = solveAssembly(planar(0.004), { up: 20, down: 20, travel: 60 })
    expect(r.ok).toBe(false)
    expect(r.problem).toBe('reach')
  })
})

describe('differential from the throws', () => {
  const geom = planar(0.0075)
  const r = upward(geom, { up: 25, down: 10, travel: 45 })

  it('uses the travel evenly about the midpoint, with neutral off square', () => {
    expect(r.ok).toBe(true)
    expect(r.surfaceAt(-r.travelNeeded)).toBeCloseTo(-25, 6)
    expect(r.surfaceAt(r.travelNeeded)).toBeCloseTo(10, 6)
    expect(r.surfaceAt(r.neutralArm)).toBeCloseTo(0, 6)
    // More up than down: neutral sits towards the down side, and the arm is square at the
    // midpoint, not at neutral
    expect(r.neutralArm).toBeGreaterThan(3)
    expect(r.armSquare).toBeCloseTo(0, 6)
    expect(r.achieved.up).toBeCloseTo(25, 4)
    expect(r.achieved.down).toBeCloseTo(10, 4)
  })
})

describe('an arm swinging across the span, on a swept hinge', () => {
  // The arm swings in the wing's plane, the horn in the chord's: a spatial linkage
  const geom = {
    pivot: [-0.08, 0.02, 0.012],
    axis: [0, 0, 1],
    ref: [1, 0, 0],
    radius: 0.012,
    hinge: { point: [0, 0, 0], axis: [0.2, 1, 0] },
    horn: [0, 0, 0.012],
  }

  it('solves, with the pushrod its length throughout', () => {
    const r = solveAssembly(geom, { up: 20, down: 15, travel: 45, facing: 1 })
    expect(r.ok).toBe(true)
    expect(r.fits).toBe(true)
    const L = linkage(geom)
    for (const servo of [-r.travelNeeded, 0, r.travelNeeded]) {
      const arm = L.arm((r.midpoint + r.direction * servo) * RAD)
      expect(dist(arm, L.hornAt(r.surfaceAt(servo) * RAD))).toBeCloseTo(r.pushrod, 9)
    }
  })

  it('gives the same throws on the other half, the servo turning the other way', () => {
    for (const facing of [1, -1]) {
      const a = solveAssembly(geom, { up: 20, down: 15, travel: 45, facing, depth: 0.04 })
      const b = solveAssembly(mirrorGeometry(geom), { up: 20, down: 15, travel: 45, facing: -facing, depth: 0.04 })
      expect(b.ok).toBe(a.ok)
      expect(b.pushrod).toBeCloseTo(a.pushrod, 9)
      expect(b.travelNeeded).toBeCloseTo(a.travelNeeded, 6)
      expect(b.neutralArm).toBeCloseTo(a.neutralArm, 6)
      expect(b.advantage).toBeCloseTo(a.advantage, 4)
      expect(b.achieved).toEqual({
        up: expect.closeTo(a.achieved.up, 6),
        down: expect.closeTo(a.achieved.down, 6),
        upMm: expect.closeTo(a.achieved.upMm, 9),
        downMm: expect.closeTo(a.achieved.downMm, 9),
      })
      // The arm's hole is the mirror image
      expect(b.points.arm[1]).toBeCloseTo(-a.points.arm[1], 9)
      expect(b.direction).toBe(-a.direction)
    }
  })
})

describe('hole positions as installed', () => {
  it('puts the arm on the output axis, a seat above the spline, turned with the servo', () => {
    const at = { x: 0.1, s: 0.3, base: -0.01 }
    // On its side the output points outboard along the span, from the case's mid-height
    const side = installedServo('hitec-hs-645mg')
    const f = side.frame
    const p = outputPivot(side, at, 0.002)
    expect(p.axis).toEqual([0, 1, 0])
    expect(p.pivot[0]).toBeCloseTo(at.x + f.output.offset, 9)
    expect(p.pivot[1]).toBeCloseTo(at.s - f.height / 2 + Math.max(f.height, f.output.top) + 0.002, 9)
    expect(p.pivot[2]).toBeCloseTo(at.base + side.lift + f.width / 2, 9)
    expect(p.ref).toEqual([1, 0, 0])
    // Rotated half round about the vertical: the output at the other end, pointing inboard
    const r = outputPivot(installedServo('hitec-hs-645mg', 0, { rotate: true }), at, 0.002)
    expect(r.axis[1]).toBe(-1)
    expect(r.pivot[0]).toBeCloseTo(at.x - f.output.offset, 9)
    expect(r.pivot[1]).toBeCloseTo(at.s - (p.pivot[1] - at.s), 9)
    expect(r.pivot[2]).toBeCloseTo(p.pivot[2], 9)
    // Flipped (upside down): the output inboard, still at the back
    const u = outputPivot(installedServo('hitec-hs-645mg', 0, { flip: true }), at, 0.002)
    expect(u.axis[1]).toBe(-1)
    expect(u.pivot[0]).toBeCloseTo(p.pivot[0], 9)
    expect(u.pivot[1]).toBeCloseTo(r.pivot[1], 9)
    // Both: at the front, outboard
    const b = outputPivot(installedServo('hitec-hs-645mg', 0, { rotate: true, flip: true }), at, 0.002)
    expect(b.axis[1]).toBe(1)
    expect(b.pivot[0]).toBeCloseTo(r.pivot[0], 9)
    expect(b.pivot[1]).toBeCloseTo(p.pivot[1], 9)
  })

  it('stands on the output boss as drawn, however the servo is turned', () => {
    const at = { x: 0.1, s: 0.3, base: -0.01 }
    for (const pose of [{}, { rotate: true }, { flip: true }, { rotate: true, flip: true }]) {
      for (const yaw of [0, 0.2, -0.3]) {
        const v = installedServo('hitec-hs-645mg', 0, { ...pose, yaw })
        const p = outputPivot(v, at, 0)
        const boss = placeServo(v, at).find((x) => x.kind === 'servoOutput')
        const c = boss.cylinder
        // The boss's far end, on its axis, turned with the servo
        const end = [c.x, c.s, c.z]
        end[{ x: 0, s: 1, z: 2 }[c.axis]] = c.axis === 'z' ? c.to : p.axis[{ x: 0, s: 1 }[c.axis]] > 0 ? c.to : c.from
        let [ex, es] = [end[0], end[1]]
        if (boss.turn) {
          const t = boss.turn
          ;[ex, es] = turnPoint([ex - t.x, es - t.s], t.yaw).map((d, k) => d + (k ? t.s : t.x))
        }
        const tag = `${JSON.stringify(pose)} ${yaw}`
        expect(p.pivot[0], tag).toBeCloseTo(ex, 9)
        expect(p.pivot[1], tag).toBeCloseTo(es, 9)
        expect(p.pivot[2], tag).toBeCloseTo(end[2], 9)
      }
    }
  })

  it('puts the horn hole over the hinge, above or below the face', () => {
    const sf = { hingeX: (s) => 0.2 + 0.1 * s, slope: 0.1 }
    const h = hingeAt(sf, 0.5, 0.003)
    expect(h.point).toEqual([0.25, 0.5, 0.003])
    expect(hornHole(h, { face: 'top', faceOffset: 0.004, height: 0.01 })[2]).toBeCloseTo(0.017, 9)
    expect(hornHole(h, { face: 'bottom', faceOffset: 0.004, height: 0.01 })[2]).toBeCloseTo(-0.011, 9)
    // Forward of the hinge is towards the leading edge
    expect(hornHole(h, { height: 0.01, forward: 0.005 })[0]).toBeLessThan(0.25)
  })
})

describe('a catalogue assembly', () => {
  it('solves an HS-645MG on its side, a Hitec arm and a Du-Bro horn, for an aileron', () => {
    const servo = installedServo('hitec-hs-645mg')
    const arm = ARMS.find((a) => a.part === '55709')
    const horn = HORNS.find((h) => h.part === '105')
    // A straight hinge at x = 0.2, the case's centre 60 mm ahead of it, its output on the
    // centre line
    const sf = { hingeX: () => 0.2, slope: 0 }
    const hinge = hingeAt(sf, 0.3, 0)
    const pivot = outputPivot(servo, { x: 0.14, s: 0.3 - 0.01, base: -servo.frame.width / 2 - servo.lift }, arm.seat)
    const geom = { ...pivot, radius: arm.holes[0].radii[2], hinge, horn: hornHole(hinge, { faceOffset: 0.005, height: horn.holes[2] }) }
    const r = [1, -1].map((facing) => solveAssembly(geom, { up: 20, down: 15, travel: 45, facing, depth: 0.05 })).find((x) => x.ok && x.points.arm[2] > pivot.pivot[2])
    expect(r.fits).toBe(true)
    // A 19 mm arm on a 27.5 mm horn needs more servo than surface: about 1.4 to 1
    expect(r.advantage).toBeGreaterThan(1.3)
    expect(r.advantage).toBeLessThan(1.6)
    expect(r.achieved.up).toBeCloseTo(20, 4)
    expect(r.achieved.down).toBeCloseTo(15, 4)
    expect(r.neutralArm).toBeGreaterThan(0)
  })
})

describe('spline teeth', () => {
  it('gives the error to the nearest tooth', () => {
    // 25 teeth, 14.4° apart
    expect(splineError(20, 25)).toBeCloseTo(5.6, 9)
    expect(splineError(-20, 25)).toBeCloseTo(-5.6, 9)
    expect(splineError(28.8, 25)).toBeCloseTo(0, 9)
    expect(splineError(20, null)).toBeNull()
  })
})
