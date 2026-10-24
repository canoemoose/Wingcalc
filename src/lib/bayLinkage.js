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

import { armsFor, armById, hornById, defaultHorn, hingeAt, hornHole, outputPivot, solveAssembly } from './linkage.js'
import { installedServo, servoById, bayOf, SERVO_HEADROOM } from './servos.js'
import { servoBox, surfaceHeight } from './wing3d.js'

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
    out.set(b.surface, { bay: b, frame, c, link, warnings: linkWarnings(b, frame, c) })
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
