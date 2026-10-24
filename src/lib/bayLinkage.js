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
// The horn sits on the hinge at the bay's own span station, so the pushrod runs square to the
// hinge until the plan places it (docs/scope-servo.md, step 4).

import { armsFor, armById, hornById, defaultHorn, hingeAt, hornHole, outputPivot, solveAssembly } from './linkage.js'
import { installedServo, servoById, SERVO_HEADROOM } from './servos.js'
import { servoBox, surfaceHeight } from './wing3d.js'

export const DEFAULT_LINK = { arm: null, armRow: 0, armHole: null, horn: null, hornHole: null, hornFace: 'top', travel: 45, facing: null, linkage: 'pushrod' }
export const TRAVELS = [45, 60]

export const linkOf = (bay) => ({ ...DEFAULT_LINK, ...(bay?.link ?? {}) })

// The link as saved: only what differs from the defaults, or null if nothing does
export function savedLink(link) {
  const out = {}
  for (const [k, v] of Object.entries(link ?? {})) if (k in DEFAULT_LINK && v !== DEFAULT_LINK[k] && v !== undefined) out[k] = v
  return Object.keys(out).length ? out : null
}

// What a built bay gives the linkage: where its servo stands, the hinge at the bay's station
// (on the centre line, with the faces' offsets from it), the surface's depth there and its
// designed throws. a: analyseStructure's result; b: one of its bays (ok). null if the bay isn't
// built or its surface isn't.
export function bayFrame(a, b) {
  if (!a || !b?.ok || !b.case) return null
  const surface = (a.surfaces ?? []).find((r) => r.id === b.surface && r.ok)
  if (!surface) return null
  const s = b.s
  const x = surface.hingeX(s)
  const upper = surfaceHeight(a, s, x, 'upper')
  const lower = surfaceHeight(a, s, x, 'lower')
  const z = (upper + lower) / 2
  const sec = a.section(s)
  const box = servoBox(a, a.structure, b)
  return {
    surface,
    label: surface.label ?? '',
    s,
    hinge: hingeAt(surface, s, z),
    faces: { top: upper - z, bottom: z - lower },
    depth: sec.xl + sec.c - x,
    up: surface.up ?? 0,
    down: surface.down ?? 0,
    at: { x: (b.case.x0 + b.case.x1) / 2, s, base: box.base },
    mounting: b.servo.mounting,
    room: b.room,
  }
}

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
  return { ...parts, face, travel, facing, matrix, armHole, hornHole, result: matrix.cells[armHole][hornHole] }
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
    const v = installedServo(o.value, mounting, mass)
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
