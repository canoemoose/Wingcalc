// A servo bay's linkage: the settings saved with the bay, the frame a built bay gives the
// linkage geometry (linkage.js), and the choices the servo configurator offers.
//
// The link, saved in the bay as `link` (only what differs from DEFAULT_LINK):
//   arm       an arm's id (linkage.js ARMS or GENERIC_ARMS), or null for the first the servo
//             is offered
//   armRow    which row of holes on it (a set's arm, a double's side), by index
//   armHole   which hole along that row, by index, or null for the best pair
//   horn      a horn's id, or null for the one the servo's class takes
//   hornHole  by index, lowest first, or null for the best pair
//   hornFace  'top' or 'bottom': the face of the surface the horn's on
//   travel    the servo's travel each way, degrees: 45 (standard) or 60 (extended end points)
//   facing    1 or -1, which way the arm points, or null for the one towards the horn's face
//   linkage   'pushrod' (the only type so far)
//   hornAt    where the horn is along the hinge, m from the surface's inner end (flat, along the
//             span), or null for square to the hinge from the servo's output
//   hornAngle the horn turned in plan from square to the hinge, degrees

import { armsFor, armById, hornById, defaultHorn, hingeAt, hornHole, outputPivot, solveAssembly, linkage } from './linkage.js'
import { installedServo, servoById, bayOf, SERVO_HEADROOM } from './servos.js'
import { servoBox, surfaceHeight, insetHeight } from './wing3d.js'

export const DEFAULT_LINK = { arm: null, armRow: 0, armHole: null, horn: null, hornHole: null, hornFace: 'top', travel: 45, facing: null, linkage: 'pushrod', hornAt: null, hornAngle: 0 }
export const TRAVELS = [45, 60]

export const linkOf = (bay) => ({ ...DEFAULT_LINK, ...(bay?.link ?? {}) })

// The link as saved: only what differs from the defaults, or null if nothing does
export function savedLink(link) {
  const out = {}
  for (const [k, v] of Object.entries(link ?? {})) if (k in DEFAULT_LINK && v !== DEFAULT_LINK[k] && v !== undefined) out[k] = v
  return Object.keys(out).length ? out : null
}

// What a built bay gives the linkage: where its servo stands and how it's turned, the hinge at
// the horn's station (on the centre line, with the faces' offsets from it), the surface's depth
// there and its designed throws. a: analyseStructure's result; b: one of its bays (ok); link: its
// link (for where the horn is). null if the bay isn't built or its surface isn't.
//   s, square   the horn's station, flat s, and the one square to the hinge from the output
//   range       the stations the horn can take, [s0, s1]: on the surface, clear of its ends
//   bayS        the bay's own station
export function bayFrame(a, b, link = DEFAULT_LINK) {
  if (!a || !b?.ok || !b.case) return null
  const surface = (a.surfaces ?? []).find((r) => r.id === b.surface && r.ok)
  if (!surface) return null
  const box = servoBox(a, a.structure, b)
  const at = { x: (b.case.x0 + b.case.x1) / 2, s: b.s, base: box.base }
  const range = [surface.s0 + HORN_END, surface.s1 - HORN_END]
  const clamp = (v) => Math.min(range[1], Math.max(range[0], v))
  // The foot of the square from the output to the hinge line in plan
  const [px, ps] = outputPivot(b.servo, at, 0).pivot
  const square = clamp(ps - (surface.slope * (surface.hingeX(ps) - px)) / (1 + surface.slope ** 2))
  const s = Number.isFinite(link.hornAt) ? clamp(surface.s0 + link.hornAt) : square
  const x = surface.hingeX(s)
  const upper = surfaceHeight(a, s, x, 'upper')
  const lower = surfaceHeight(a, s, x, 'lower')
  const z = (upper + lower) / 2
  const sec = a.section(s)
  return {
    surface,
    label: surface.label ?? '',
    s,
    square,
    range,
    bayS: b.s,
    hinge: hingeAt(surface, s, z),
    faces: { top: upper - z, bottom: z - lower },
    depth: sec.xl + sec.c - x,
    up: surface.up ?? 0,
    down: surface.down ?? 0,
    at,
    turn: { quarter: !!b.servo.quarter, yaw: b.servo.yaw ?? 0 },
    mounting: b.servo.mounting,
    room: b.room,
  }
}
// The least a horn's centre keeps from its surface's ends, m
export const HORN_END = 0.008

// Whether a servo fits the bay where it is: the depth it needs (its own, or its plate's top,
// plus the headroom) against the depth the bay has. { ok, need, room }
export function servoFits(frame, servo) {
  const need = Math.max(servo.height, servo.lugHeight + servo.lugThickness + (servo.plate ?? 0)) + SERVO_HEADROOM
  return { ok: !(frame.room < need), need, room: frame.room }
}

// The arm, its row, the horn and the facing the link resolves to for a servo (the defaults
// filled in), with the arm's choices.
export function resolveLink(servo, link) {
  const arms = armsFor(servoById(servo.id) ?? servo)
  const arm = (link.arm && arms.find((x) => x.id === link.arm)) || arms[0] || armById('generic-micro')
  const armRow = Math.min(Math.max(0, link.armRow ?? 0), arm.holes.length - 1)
  const horn = (link.horn && hornById(link.horn)) || defaultHorn(servo)
  return { arms, arm, armRow, horn }
}

// The geometry for one arm hole and one horn hole (indices)
export function assemblyGeometry(frame, servo, { arm, armRow, horn }, armIndex, hornIndex, face) {
  const pivot = outputPivot(servo, frame.at, arm.seat)
  return {
    ...pivot,
    radius: arm.holes[armRow].radii[armIndex],
    hinge: frame.hinge,
    horn: hornHole(frame.hinge, { face, faceOffset: frame.faces[face], height: horn.holes[hornIndex] }),
  }
}

// The facing whose arm points towards the horn's face (up for a top horn), or 1 where neither
// does more than the other (an upright servo's arm swings level)
function autoFacing(frame, servo, parts, face) {
  const want = face === 'bottom' ? -1 : 1
  let best = 1
  let score = -Infinity
  for (const facing of [1, -1]) {
    const geom = assemblyGeometry(frame, servo, parts, parts.arm.holes[parts.armRow].radii.length - 1, parts.horn.holes.length - 1, face)
    const r = solveAssembly(geom, { up: frame.up, down: frame.down, travel: 60, facing })
    if (!r.ok) continue
    const lean = (r.points.arm[2] - geom.pivot[2]) * want
    if (lean > score + 1e-6) {
      score = lean
      best = facing
    }
  }
  return best
}

// Every arm hole against every horn hole on the chosen row and horn: the result of each, and the
// best (within the travel, using the most of it: the finest control). cells[i][j] for arm hole
// i, horn hole j.
export function holeMatrix(frame, servo, parts, { travel, facing, face }) {
  const opts = { up: frame.up, down: frame.down, travel, facing, depth: frame.depth }
  const radii = parts.arm.holes[parts.armRow].radii
  let best = null
  const cells = radii.map((_, i) =>
    parts.horn.holes.map((__, j) => {
      const r = solveAssembly(assemblyGeometry(frame, servo, parts, i, j, face), opts)
      if (r.ok && r.fits && (!best || r.travelNeeded > best.travelNeeded)) best = { armHole: i, hornHole: j, travelNeeded: r.travelNeeded }
      return r
    }),
  )
  return { cells, best }
}

// Everything the configurator shows for a bay with a servo and a link: the parts, the facing,
// the hole matrix, the holes used (the chosen ones, or the best pair, or failing that the pair
// nearest to fitting) and the solved assembly. servo: installed.
export function configureBay(frame, servo, link) {
  const parts = resolveLink(servo, link)
  const face = link.hornFace === 'bottom' ? 'bottom' : 'top'
  const travel = TRAVELS.includes(link.travel) ? link.travel : 45
  const facing = link.facing === 1 || link.facing === -1 ? link.facing : autoFacing(frame, servo, parts, face)
  const matrix = holeMatrix(frame, servo, parts, { travel, facing, face })
  const radii = parts.arm.holes[parts.armRow].radii
  const inRange = (v, n) => Number.isInteger(v) && v >= 0 && v < n
  let armHole = inRange(link.armHole, radii.length) ? link.armHole : null
  let hornHole = inRange(link.hornHole, parts.horn.holes.length) ? link.hornHole : null
  if (armHole == null || hornHole == null) {
    // The best pair, keeping whichever hole was chosen
    const pick = nearestFit(matrix.cells, armHole, hornHole)
    armHole = armHole ?? pick.armHole
    hornHole = hornHole ?? pick.hornHole
  }
  const result = matrix.cells[armHole][hornHole]
  return { ...parts, face, travel, facing, matrix, armHole, hornHole, result, rodAngle: rodAngle(frame, result, link.hornAngle) }
}

// The pushrod's angle in plan from the horn's plane (square to the hinge, turned by hornAngle
// degrees), at the servo's midpoint, degrees, or null if it's not solved
function rodAngle(frame, r, hornAngle = 0) {
  if (!r?.ok) return null
  const d = [r.points.horn[0] - r.points.arm[0], r.points.horn[1] - r.points.arm[1]]
  const h = frame.hinge.axis
  const t = ((hornAngle || 0) * Math.PI) / 180
  // Square to the hinge, aft, turned
  const sq = [h[1], -h[0]]
  const plane = [sq[0] * Math.cos(t) - sq[1] * Math.sin(t), sq[0] * Math.sin(t) + sq[1] * Math.cos(t)]
  const n = Math.hypot(...d) * Math.hypot(...plane)
  if (!(n > 0)) return null
  const c = Math.abs((d[0] * plane[0] + d[1] * plane[1]) / n)
  return (Math.acos(Math.min(1, c)) * 180) / Math.PI
}

// How far the pushrod may run off the horn's plane in plan before it's warned, degrees
export const ROD_OFF_SQUARE = 10

// Every built bay's linkage on a control surface: Map of surface id -> { bay, frame, c (as
// configureBay), warnings ([{ id, message }]) }. a: analyseStructure's result; controls: the
// wing's (for each bay's link).
export function bayLinkages(a, controls) {
  const out = new Map()
  for (const b of a?.bays ?? []) {
    if (b.brake) continue
    const link = linkOf(bayOf(controls, b.surface))
    const frame = bayFrame(a, b, link)
    if (!frame) continue
    const c = configureBay(frame, b.servo, link)
    const fit = linkageFit(a, b, frame, c, link)
    out.set(b.surface, { bay: b, frame, c, link, fit, solids: linkageSolids(frame, b.servo, c, link), warnings: [...linkWarnings(b, frame, c), ...fit.warnings] })
  }
  return out
}

function linkWarnings(b, frame, c) {
  const r = c.result
  const name = `${b.label} (${frame.label})`
  if (!r.ok) return [{ id: `linkage-reach-${b.surface}`, message: `${name}: its arm and horn holes can't give the designed throws without the arm passing dead centre. Choose other holes in Servo and linkage.` }]
  const out = []
  if (!r.fits) {
    out.push({
      id: `linkage-travel-${b.surface}`,
      message: `${name}: the designed throws need ±${r.travelNeeded.toFixed(0)}° of servo travel, more than its ±${c.travel}°, so it reaches only ${r.achieved.up.toFixed(0)}° up and ${r.achieved.down.toFixed(0)}° down. Use an arm hole further out or a horn hole lower down${c.travel === 45 ? ', or extended end points' : ''}.`,
    })
  }
  if (c.rodAngle != null && c.rodAngle > ROD_OFF_SQUARE) {
    out.push({
      id: `linkage-square-${b.surface}`,
      message: `${name}: the pushrod runs ${c.rodAngle.toFixed(0)}° off the horn's plane, which binds the clevis. Move the horn along the hinge, turn it to line up, or square the servo to the hinge.`,
    })
  }
  return out
}

// The pair that fits using the most travel, or, with none fitting, the one needing the least,
// among those agreeing with a hole already chosen
function nearestFit(cells, armHole, hornHole) {
  let fit = null
  let near = null
  cells.forEach((row, i) =>
    row.forEach((r, j) => {
      if ((armHole != null && i !== armHole) || (hornHole != null && j !== hornHole) || !r.ok) return
      if (r.fits && (!fit || r.travelNeeded > fit.t)) fit = { armHole: i, hornHole: j, t: r.travelNeeded }
      if (!near || r.travelNeeded < near.t) near = { armHole: i, hornHole: j, t: r.travelNeeded }
    }),
  )
  return fit ?? near ?? { armHole: armHole ?? 0, hornHole: hornHole ?? 0 }
}

// The servos the picker lists, each with whether it fits the bay (and why not)
export function servoChoices(frame, options, mounting, mass) {
  return options.map((o) => {
    const v = installedServo(o.value, mounting, mass, frame.turn)
    const f = servoFits(frame, v)
    const mm = (x) => `${(x * 1000).toFixed(0)} mm`
    return { ...o, fits: f.ok, reason: f.ok ? '' : `Needs ${mm(f.need)} of depth, the bay has ${mm(Math.max(0, f.room))}` }
  })
}

// A short summary of a link: "HS-5125MG › Hitec 55706 (single), hole 2 › Du-Bro 848, hole 3"
export function linkSummary(servo, c) {
  const armName = c.arm.maker === 'Generic' ? c.arm.name : `${c.arm.maker} ${c.arm.part}`
  const row = c.arm.holes.length > 1 ? ` (${c.arm.holes[c.armRow].arm})` : ''
  return `${servo.label} › ${armName}${row}, hole ${c.armHole + 1} › ${c.horn.maker} ${c.horn.part}, hole ${c.hornHole + 1}`
}

// --- The parts in the wing ---------------------------------------------------------------------

// Sizes the arm, horn and pushrod are drawn and checked at, by the arm's or horn's size, m: the
// arm's width and thickness and how far its end runs past its outer hole; the horn plate's
// thickness, its base along its plane as a share of its height, and its tip; the pushrod wire's
// radius (1.2, 1.6 and 2 mm wire)
export const PART_SIZES = {
  arm: { micro: { width: 0.0045, thickness: 0.002, tip: 0.0025 }, standard: { width: 0.006, thickness: 0.0025, tip: 0.003 }, large: { width: 0.008, thickness: 0.003, tip: 0.004 } },
  horn: { micro: 0.0015, mini: 0.0015, standard: 0.002, large: 0.0025, base: 0.7, tip: 0.004 },
  rod: { micro: 0.0006, standard: 0.0008, large: 0.001 },
}

const v3 = {
  add: (p, q) => [p[0] + q[0], p[1] + q[1], p[2] + q[2]],
  sub: (p, q) => [p[0] - q[0], p[1] - q[1], p[2] - q[2]],
  mul: (p, k) => [p[0] * k, p[1] * k, p[2] * k],
  cross: (p, q) => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]],
  unit: (p) => {
    const n = Math.hypot(...p) || 1
    return [p[0] / n, p[1] / n, p[2] / n]
  },
}

// A box from p0 to p1 with its width along u and its thickness along v: two rectangular rings
const barRings = (p0, p1, u, v, w, t) =>
  [p0, p1].map((p) => [
    v3.add(p, v3.add(v3.mul(u, w / 2), v3.mul(v, t / 2))),
    v3.add(p, v3.add(v3.mul(u, -w / 2), v3.mul(v, t / 2))),
    v3.add(p, v3.add(v3.mul(u, -w / 2), v3.mul(v, -t / 2))),
    v3.add(p, v3.add(v3.mul(u, w / 2), v3.mul(v, -t / 2))),
  ])

// A round rod from p0 to p1, radius r: two 12-sided rings square to it
function rodRings(p0, p1, r) {
  const d = v3.unit(v3.sub(p1, p0))
  const u = v3.unit(v3.cross(d, Math.abs(d[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]))
  const w = v3.cross(d, u)
  const ring = (p) => Array.from({ length: 12 }, (_, i) => v3.add(p, v3.add(v3.mul(u, r * Math.cos((2 * Math.PI * i) / 12)), v3.mul(w, r * Math.sin((2 * Math.PI * i) / 12)))))
  return [ring(p0), ring(p1)]
}

// The arm's angle (radians from its reference) with the servo at an angle from its midpoint
// (degrees, in its turning direction for trailing edge down)
const armAngle = (r, servoDeg) => ((r.midpoint + r.direction * servoDeg) * Math.PI) / 180

// The assembly at surface neutral as solids, each { kind, rings } with rings in the wing's flat
// frame ([x, s, z]), for wing3d to place: the arm ('servoArm'), the horn ('horn') and the
// pushrod ('pushrod'). Empty where the linkage isn't solved.
export function linkageSolids(frame, servo, c, link = DEFAULT_LINK) {
  const r = c.result
  if (!r?.ok) return []
  const g = assemblyGeometry(frame, servo, c, c.armHole, c.hornHole, c.face)
  const L = linkage(g)
  const t0 = armAngle(r, r.neutralArm)
  const d = L.armDir(t0)
  const A = PART_SIZES.arm[c.arm.size] ?? PART_SIZES.arm.standard
  const radii = c.arm.holes[c.armRow].radii
  const across = v3.cross(L.a, d)
  const hub = A.width / 2
  const arm = barRings(v3.add(g.pivot, v3.mul(d, -hub)), v3.add(g.pivot, v3.mul(d, radii.at(-1) + A.tip)), across, L.a, A.width, A.thickness)
  // The horn: a plate standing on its face in its plane (square to the hinge, turned), over the
  // hinge line, tapering from its base to its tip
  const h = frame.hinge
  const ang = ((link.hornAngle || 0) * Math.PI) / 180
  const sq = [h.axis[1], -h.axis[0]]
  const along = [sq[0] * Math.cos(ang) - sq[1] * Math.sin(ang), sq[0] * Math.sin(ang) + sq[1] * Math.cos(ang), 0]
  const normal = [-along[1], along[0], 0]
  const up = c.face === 'bottom' ? -1 : 1
  const z0 = h.point[2] + up * frame.faces[c.face]
  const H = c.horn
  const ht = PART_SIZES.horn[H.size] ?? PART_SIZES.horn.standard
  const plate = (z, len) => {
    const o = [h.point[0], h.point[1], z]
    return [
      v3.add(o, v3.add(v3.mul(along, len / 2), v3.mul(normal, ht / 2))),
      v3.add(o, v3.add(v3.mul(along, -len / 2), v3.mul(normal, ht / 2))),
      v3.add(o, v3.add(v3.mul(along, -len / 2), v3.mul(normal, -ht / 2))),
      v3.add(o, v3.add(v3.mul(along, len / 2), v3.mul(normal, -ht / 2))),
    ]
  }
  const horn = [plate(z0, H.height * PART_SIZES.horn.base), plate(z0 + up * H.height, PART_SIZES.horn.tip)]
  const rod = rodRings(L.arm(t0), g.horn, PART_SIZES.rod[c.arm.size] ?? PART_SIZES.rod.standard)
  return [
    { kind: 'servoArm', rings: arm },
    { kind: 'horn', rings: horn },
    { kind: 'pushrod', rings: rod },
  ]
}

// --- Fit in the wing -----------------------------------------------------------------------------

// Whether the arm and pushrod clear the wing over the travel the designed throws use: where the
// arm's end sweeps through a skin (inside the hatch, a slot in the hatch; elsewhere a slot in
// the skin) or into the bay's ribs, and where the pushrod leaves the wing (a slot), which must be
// ahead of the fixed hinge spar. { slots: [{ what, surface, hatch, x0, x1, s0, s1 }], clashes:
// [...], warnings }.
export function linkageFit(a, b, frame, c, link = DEFAULT_LINK) {
  const out = { slots: [], clashes: [], warnings: [] }
  const r = c.result
  if (!r?.ok) return out
  const st = a.structure
  const g = assemblyGeometry(frame, b.servo, c, c.armHole, c.hornHole, c.face)
  const L = linkage(g)
  const A = PART_SIZES.arm[c.arm.size] ?? PART_SIZES.arm.standard
  const rod = PART_SIZES.rod[c.arm.size] ?? PART_SIZES.rod.standard
  const reach = c.arm.holes[c.armRow].radii.at(-1) + A.tip
  const T = Math.min(r.travelNeeded, c.travel)
  const sweep = Array.from({ length: 13 }, (_, i) => -T + (2 * T * i) / 12)
  // Where a point is: 'in' between the skins' inner faces, 'top' or 'bottom' through or beyond
  // a skin, or 'off' the chord
  const where = ([x, s, z], pad = 0) => {
    const sec = a.section(s)
    if (!sec || x < sec.xl || x > sec.xl + sec.c) return 'off'
    if (z + pad > insetHeight(a, st, s, x, 'upper')) return 'top'
    if (z - pad < insetHeight(a, st, s, x, 'lower')) return 'bottom'
    return 'in'
  }
  const hatch = b.hatch
  const inHatch = ([x, s]) => hatch && x >= hatch.x0 && x <= hatch.x1 && s >= hatch.s0 && s <= hatch.s1
  const grow = (what, surface, pts, pad) => {
    if (!pts.length) return
    const x = pts.map((p) => p[0])
    const q = pts.map((p) => p[1])
    out.slots.push({ what, surface, hatch: surface === 'bottom' && pts.every(inHatch), x0: Math.min(...x) - pad, x1: Math.max(...x) + pad, s0: Math.min(...q) - pad, s1: Math.max(...q) + pad })
  }
  const mm = (v) => `${(v * 1000).toFixed(0)} mm`
  const name = `${b.label} (${frame.label})`

  // The arm's end over its sweep, half its thickness either side of its plane
  const ends = sweep.map((x) => v3.add(g.pivot, v3.mul(L.armDir(armAngle(r, x)), reach)))
  const half = A.thickness / 2
  for (const surface of ['top', 'bottom']) {
    const through = ends.filter((p) => where(p, half) === surface)
    grow('arm', surface, through, A.width / 2)
  }
  const ribs = b.inner ?? [b.sA, b.sB]
  // The arm's end reaches this far along the span either side of its centre line: half its
  // width across it and half its thickness along the output's axis, as they lie
  const spread = (t) => Math.abs(v3.cross(L.a, L.armDir(t))[1]) * (A.width / 2) + Math.abs(L.a[1]) * half
  if (ends.some((p, i) => where(p) === 'in' && (p[1] - spread(armAngle(r, sweep[i])) < ribs[0] || p[1] + spread(armAngle(r, sweep[i])) > ribs[1]))) {
    out.clashes.push('rib')
    out.warnings.push({ id: `linkage-rib-${b.surface}`, message: `${name}: its arm sweeps into the bay's ribs. Use a shorter arm or an inner hole, or turn the servo so the arm swings along the chord.` })
  }
  for (const sl of out.slots.filter((x) => x.what === 'arm' && !x.hatch)) {
    out.clashes.push(`arm-${sl.surface}`)
    out.warnings.push({
      id: `linkage-arm-${sl.surface}-${b.surface}`,
      message: `${name}: its arm sweeps through the ${sl.surface} skin${sl.surface === 'bottom' ? ' outside the hatch' : ''}, so it needs a slot ${mm(sl.x1 - sl.x0)} by ${mm(sl.s1 - sl.s0)} there. Use a shorter arm, mount the servo so its arm stays inside the wing or comes out through the hatch, or accept the slot.`,
    })
  }

  // The pushrod at mid travel and each end: where it crosses a skin, and whether it's still in
  // the wing where the fixed hinge spar is
  const cross = { top: [], bottom: [] }
  const spar = frame.surface.faces?.fixedFront
  let intoSpar = false
  for (const x of [-T, 0, T]) {
    const p0 = L.arm(armAngle(r, x))
    const d = r.surfaceAt(x)
    if (d == null) continue
    const p1 = L.hornAt((d * Math.PI) / 180)
    let last = where(p0)
    for (let i = 1; i <= 40; i++) {
      const p = v3.add(p0, v3.mul(v3.sub(p1, p0), i / 40))
      const w = where(p, rod)
      if (w !== last && (w === 'top' || w === 'bottom' || last === 'top' || last === 'bottom')) cross[w === 'in' ? last : w].push(p)
      if (w === 'in' && spar && p[0] > spar(p[1]) - rod) intoSpar = true
      last = w
    }
  }
  for (const surface of ['top', 'bottom']) grow('pushrod', surface, cross[surface], rod + 0.001)
  if (intoSpar) {
    out.clashes.push('spar')
    out.warnings.push({
      id: `linkage-spar-${b.surface}`,
      message: `${name}: the pushrod is still inside the wing at the fixed hinge spar, so it would run into it. Put the horn on the ${c.face === 'top' ? 'bottom' : 'top'} face, use a horn hole further from the face, or mount the servo so the pushrod leaves the wing sooner.`,
    })
  }
  return out
}
