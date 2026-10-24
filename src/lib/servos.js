// Servos and their bays: the catalogue by class, which bay each control surface gets, where it
// goes along the span, and what its mass does to the spar loads.
//
// Nothing here knows which wing it's on: placement takes a wing sampler and resolved control
// surfaces (controlSurfaces.js), so a tailplane's elevator servo uses the same code. The
// bay's geometry in the built-up structure (plate, hatch, lead holes) is in structure.js
// bayLayouts and ribs.js.
//
// A bay is saved as the settings that differ from the defaults, in controls.bays:
//   surface   the id of the control surface it works
//   enabled   false once removed (default true: every surface has a bay)
//   class     a servo: a class from SERVOS or a Hitec id, or null for the class that suits the
//             model's weight
//   mounting  'side' (default: its arm swings fore and aft), 'upright' or 'flat': see MOUNTINGS
//   along     where its centre is, m from the surface's inner end (surface.from), along the
//             surface; null for a third of the way out along it
//   at        the older panel-relative position, m from the panel's inner end; used only when
//             along is not set (saves from before along)
//   square    'chord' (default) or 'hinge': the servo's length square to the chord (along it) or
//             square to the surface's hinge line in plan, so the pushrod meets the horn square
//   quarterTurn  true to turn it a quarter in plan from there (its length across the span)
//   link      the servo's linkage to its surface, as differs from the defaults (bayLinkage.js
//             DEFAULT_LINK): arm, horn, holes, travel; null for the defaults

import { HITEC_SPECS, FUTABA_FIGURES } from './servoCatalogue.js'

// Servo classes. Generic sizes, no brand: each is the rounded figures of the common hobby
// servos of that class (docs/methods.md), all in SI base units.
//   length, width, height  the case body, lengths along the chord, across the span (a bay is
//                          this wide between its ribs) and from the base to the top of the case
//   lugSpan, lugThickness  overall length across the mounting lugs, and the lugs' thickness
//   lugHeight              from the case base up to the underside of the lugs
//   mass                   the servo with its lead, kg
//   torque                 stall torque at 4.8 V, rounded down, N·m
//   plate                  the mount plate's ply thickness, m
//   leadHole               the hole a lead passes through the ribs by, m
//   pilot                  the pilot hole for a lug screw in the mount plate, m
export const SERVOS = {
  'sub-micro': {
    label: 'Sub-micro',
    size: 'about 4 g',
    length: 0.0205,
    width: 0.0085,
    height: 0.016,
    lugSpan: 0.0275,
    lugThickness: 0.0015,
    lugHeight: 0.011,
    mass: 0.004,
    torque: 0.06,
    plate: 0.0015,
    leadHole: 0.004,
    pilot: 0.001,
  },
  micro: {
    label: 'Micro',
    size: 'the 9 g class',
    length: 0.023,
    width: 0.0122,
    height: 0.0225,
    lugSpan: 0.0325,
    lugThickness: 0.0025,
    lugHeight: 0.0155,
    mass: 0.009,
    torque: 0.15,
    plate: 0.0015,
    leadHole: 0.006,
    pilot: 0.001,
  },
  mini: {
    label: 'Mini',
    size: 'the 17 g class',
    length: 0.0285,
    width: 0.0125,
    height: 0.026,
    lugSpan: 0.039,
    lugThickness: 0.0025,
    lugHeight: 0.0185,
    mass: 0.017,
    torque: 0.28,
    plate: 0.002,
    leadHole: 0.007,
    pilot: 0.0012,
  },
  standard: {
    label: 'Standard',
    size: 'the 40 g class',
    length: 0.0405,
    width: 0.02,
    height: 0.0365,
    lugSpan: 0.055,
    lugThickness: 0.0025,
    lugHeight: 0.0255,
    mass: 0.045,
    torque: 0.4,
    plate: 0.003,
    leadHole: 0.01,
    pilot: 0.0015,
  },
}

export const SERVO_CLASSES = Object.keys(SERVOS)

// The least ply a mount plate keeps round its cut-out, and the gap the cut-out leaves round
// what passes through it, m
export const PLATE_EDGE = 0.003
export const CUTOUT_GAP = 0.0005
// The least ply left between a lug screw's pilot hole and the cut-out, m
export const SCREW_EDGE = 0.001
// Room left beside the servo in the bay, each side across the span, to the rib faces: the
// cut-out's gap and the plate's edge, m
export const SERVO_CLEARANCE = CUTOUT_GAP + PLATE_EDGE
// The top of the case's clearance under the upper skin, m
export const SERVO_HEADROOM = 0.002

// ---------------------------------------------------------------------------------------------
// Hitec catalogue. Each entry is a real servo; the generic classes above remain the fallback.
// The case, lug and output figures are read from the dimensioned drawing on the servo's
// hitecrcd.com product page (October 2026); masses and torques from the same pages. Units are
// converted here: mm to m, g to kg, kg·cm to N·m.
//
//   id, model, maker   the picker's id ('hitec-' + the model), the model name, 'Hitec'
//   class              the generic class it's sized as, for plate and lead hole
//   body               [length, width, height] of the case, m: length along the lugs (and the
//                      chord, upright), width across, height from the base to the top of the
//                      case or its gear tower, not counting the output spline
//   lugSpan            the mounting lugs' overall length, m
//   lugThickness       the lugs' thickness, m
//   lugHeight          from the base to the underside of the lugs, m (a wing servo's: to the
//                      lower edge of its upper pair)
//   caseHeight         the top of the case's main block where a gear tower stands above it, m
//                      (the tower is the rest of body's height); the height itself without one
//   output             the output spline's boss: offset (its centre from the case's centre,
//                      along the length towards the lead end), top (the horn seat, from the
//                      base) and diameter, m
//   lead               where the lead leaves: exit 'end' (the end nearer the output, at a
//                      height above the base) or 'base' (through the base, at an offset along
//                      the length from the centre); at, m
//   wingLugs           a wing servo's lugs, which stand in the length-height plane, centred on
//                      the case's thickness, rather than lying across it: a pair at the top,
//                      length long, and at the bottom either a second pair or a single tab
//                      ([width, length] below the base), m
//   drawing            the drawing the figures come from, where it's another model's
//   mass               with its lead, kg
//   torque             stall torque at about 4.8 to 6 V, N·m
//   thin               a thin wing servo, the kind that lies flat in a thin wing
//   plate, leadHole,   from the generic class above
//   pilot
//
// Every dimension is a figure printed on the drawing except the output boss's diameter and the
// lead's place, which are scaled off it (to about half a millimetre).
//
// Dropped: HS-422, discontinued. HS-75BB is a retract servo, so it isn't listed; HS-50, HS-82MG
// and HS-325HB had no published figures to hand. Torque is the higher, 6 V, figure where both
// are given. D141SW is no longer on hitecrcd.com: its figures are from the D141SH, which Hitec
// lists in the same case.
const KG_CM = 0.0980665
const fromClass = (cls) => ({ plate: SERVOS[cls].plate, leadHole: SERVOS[cls].leadHole, pilot: SERVOS[cls].pilot })

// A drawing's figures in mm, as an entry's fields in m
function drawn({ body, case: caseHeight, lugs, wing, output, lead, drawing }) {
  const m = (v) => Math.round(v * 1e4) / 1e7
  const [span, thickness, height] = lugs
  const out = {
    body: body.map(m),
    lugSpan: m(span),
    lugThickness: m(thickness),
    lugHeight: m(height),
    caseHeight: m(caseHeight ?? body[2]),
    output: { offset: m(output[0]), top: m(output[1]), diameter: m(output[2]) },
    ...(lead ? { lead: { exit: lead[0], at: m(lead[1]) } } : {}),
  }
  if (wing) out.wingLugs = { length: m(wing.length), bottom: wing.tab ? 'tab' : 'lugs', ...(wing.tab ? { tab: wing.tab.map(m) } : {}) }
  if (drawing) out.drawing = drawing
  return out
}

// The shared cases, mm. lugs: [span, thickness, underside height]; output: [offset, top,
// diameter]; lead: [exit, at]
const FEATHER_65 = { body: [23.6, 11.6, 26.0], case: 20.0, lugs: [32.3, 2.0, 17.0], output: [5.7, 28.6, 6], lead: ['end', 3.5] }
const FEATHER_55 = { body: [22.8, 11.6, 24.0], case: 20.8, lugs: [32.6, 1.0, 16.7], output: [5.3, 26.8, 5], lead: ['end', 3.5] }
const MICRO_85 = { body: [29.0, 13.0, 29.4], lugs: [39.8, 2.0, 19.2], output: [7.85, 33.5, 9.5], lead: ['end', 4.0] }
const MINI_225 = { body: [32.2, 16.8, 31.0], lugs: [44.0, 2.2, 23.8], output: [7.4, 36.1, 10], lead: ['end', 4.5] }
const WING_125 = { body: [30.0, 10.0, 34.0], lugs: [42.0, 2.0, 24.0], wing: { length: 10.0, tab: [10.0, 6.0] }, output: [8.7, 37.1, 6], lead: ['end', 7.5] }
const STD_311 = { body: [40.0, 20.0, 36.5], lugs: [52.8, 2.5, 26.5], output: [10.0, 41.0, 12], lead: ['end', 3.0] }
const STD_485 = { body: [40.0, 20.0, 38.0], lugs: [53.0, 2.5, 28.0], output: [10.0, 42.5, 12], lead: ['end', 6.0] }
const STD_645 = { body: [40.8, 20.0, 37.8], lugs: [53.4, 2.5, 27.0], output: [10.0, 42.8, 12], lead: ['end', 5.0] }

// The published specs every catalogue entry carries (servoCatalogue.js), in SI units:
//   ratings   [{ volts, torque (N·m), speed (s per 60°) }], null where not given at that voltage
//   gears     'plastic', 'karbonite', 'metal' or 'titanium', or null if not published
//   digital   true, false, or null if not published
//   spline    { type, teeth }: the output spline as the maker names it, and its tooth count
//             where that's published (Futaba names its by size and gives none); null if unknown
//   current   false for a model kept though no longer made
const ratingsOf = (rows) => rows.map(([volts, torque, speed]) => ({ volts, torque: torque == null ? null : torque * KG_CM, speed }))
const splineOf = (type, maker) => {
  if (!type) return null
  const n = maker === 'Hitec' ? Number(type.match(/\d+/)?.[0]) : NaN
  return { type, teeth: Number.isFinite(n) ? n : null }
}
const specs = (maker, { ratings, gears = null, digital = null, spline = null, current = true }) => ({
  ratings: ratingsOf(ratings),
  gears,
  digital,
  spline: splineOf(spline, maker),
  current,
})

// The torque a servo is listed by: its rating nearest 6 V (the higher voltage of two as near)
export function ratedTorque(ratings) {
  const ok = (ratings ?? []).filter((r) => r.torque > 0)
  if (!ok.length) return null
  return ok.reduce((a, r) => (Math.abs(r.volts - 6) < Math.abs(a.volts - 6) - 1e-9 || (Math.abs(Math.abs(r.volts - 6) - Math.abs(a.volts - 6)) < 1e-9 && r.volts > a.volts) ? r : a)).torque
}

const hitec = (model, cls, mass, torque, thin, d) => ({
  id: `hitec-${model.toLowerCase()}`,
  model,
  maker: 'Hitec',
  class: cls,
  ...drawn(d),
  mass: mass / 1000,
  torque: torque * KG_CM,
  thin,
  ...fromClass(cls),
  ...specs('Hitec', HITEC_SPECS[model]),
})

export const HITEC = [
  hitec('HS-65MG', 'micro', 11.9, 2.2, false, FEATHER_65),
  hitec('HS-5070MH', 'micro', 12.7, 3.1, false, { body: [23.6, 11.6, 30.0], case: 24.0, lugs: [32.3, 2.0, 21.0], output: [5.7, 32.6, 6], lead: ['end', 1.5] }),
  hitec('HS-5085MG', 'micro', 21.9, 4.3, false, { ...MICRO_85, output: [7.95, 33.5, 9.5] }),
  hitec('HS-85MG', 'micro', 21.9, 3.5, false, MICRO_85),
  hitec('D89MW', 'micro', 25, 8.5, false, { body: [29.0, 13.0, 30.0], lugs: [39.8, 2.0, 19.5], output: [7.9, 33.9, 9.5], lead: ['end', 3.0] }),
  hitec('HS-81', 'micro', 16.6, 3.0, false, { body: [30.0, 12.0, 29.6], case: 26.0, lugs: [40.8, 2.0, 19.9], output: [4.6, 32.7, 8], lead: ['end', 6.0] }),
  hitec('HS-5125MG', 'mini', 24, 3.5, true, WING_125),
  hitec('HS-125MG', 'mini', 24, 3.5, true, WING_125),
  hitec('D131MW', 'micro', 9.8, 2.9, true, { body: [22.0, 8.5, 23.2], case: 19.0, lugs: [28.0, 1.5, 16.8], output: [6.4, 25.9, 8], lead: ['end', 9.0] }),
  hitec('D141SW', 'mini', 26, 7.0, true, { body: [30.0, 10.0, 29.5], lugs: [42.0, 1.8, 19.8], wing: { length: 9.7, tab: [10.1, 6.5] }, output: [8.4, 32.7, 6], lead: ['end', 8.5], drawing: 'D141SH' }),
  hitec('D145SW', 'mini', 24, 6.0, true, { body: [30.0, 10.0, 37.0], lugs: [42.0, 2.0, 27.0], wing: { length: 10.0 }, output: [8.7, 38.5, 7], lead: ['base', 10.0] }),
  hitec('HS-7115TH', 'mini', 20, 3.9, true, { body: [26.0, 8.0, 38.0], lugs: [38.0, 2.0, 28.0], wing: { length: 10.0 }, output: [5.4, 40.8, 5], lead: ['base', 7.0] }),
  hitec('HS-225MG', 'mini', 31, 4.8, false, MINI_225),
  hitec('HS-5245MG', 'mini', 32, 5.5, false, { ...MINI_225, lead: ['end', 5.0] }),
  hitec('HS-55', 'micro', 8, 1.5, false, FEATHER_55),
  hitec('HS-65HB', 'micro', 11.2, 1.9, false, FEATHER_65),
  hitec('HS-5055MG', 'micro', 9.5, 1.6, false, { ...FEATHER_55, output: [5.3, 26.7, 5] }),
  hitec('HS-5065MG', 'micro', 11.9, 2.2, false, { ...FEATHER_65, output: [5.7, 28.5, 6] }),
  hitec('HS-85BB', 'micro', 19.2, 3.5, false, MICRO_85),
  hitec('HS-225BB', 'mini', 27, 4.8, false, MINI_225),
  hitec('HS-77BB', 'standard', 35, 5.5, false, { body: [44.1, 23.0, 24.8], lugs: [56.0, 2.5, 16.7], output: [10.5, 27.4, 11], lead: ['end', 5.5] }),
  hitec('HS-311', 'standard', 43, 3.7, false, STD_311),
  hitec('HS-322HD', 'standard', 43, 3.7, false, STD_311),
  hitec('HS-485HB', 'standard', 45, 6.0, false, STD_485),
  hitec('HS-5485HB', 'standard', 45, 6.4, false, STD_485),
  hitec('HS-625MG', 'standard', 55.2, 6.8, false, STD_645),
  hitec('HS-645MG', 'standard', 55.2, 9.6, false, STD_645),
  hitec('HS-5625MG', 'standard', 60, 9.4, false, STD_645),
  hitec('HS-5645MG', 'standard', 60, 12.1, false, STD_645),
]

// ---------------------------------------------------------------------------------------------
// Futaba catalogue (servoCatalogue.js). A model with a drawing (futaba.uk) carries its figures
// as the Hitec ones do; what its drawing doesn't show (estimated: 'lead' on some, everything but
// the case on a model with no drawing) is the class's, the lug span scaled with the case's
// length (servoFrame). estimated names those parts, for the side view and the bay hint.
const futaba = ({ model, class: cls, body, mass, thin = false, drawing, ...rest }) => {
  const s = specs('Futaba', rest)
  const fig = drawing ? drawn(drawing) : { body: body.map((v) => Math.round(v * 1e4) / 1e7) }
  const estimated = drawing ? (drawing.lead ? [] : ['lead']) : ['lugs', 'output', 'lead']
  return {
    id: `futaba-${model.toLowerCase()}`,
    model,
    maker: 'Futaba',
    class: cls,
    ...fig,
    mass: mass / 1000,
    torque: ratedTorque(s.ratings),
    thin,
    ...(estimated.length ? { estimated } : {}),
    ...fromClass(cls),
    ...s,
  }
}

export const FUTABA = FUTABA_FIGURES.map(futaba)

// Every maker's servo, Hitec first
export const CATALOGUE = [...HITEC, ...FUTABA]

// The mounting a servo goes in, and the envelope it takes up in the wing: chord (along the
// chord), span (across the span) and depth (from the skin inward). Upright stands the case on
// its base; side lies it on its side; flat lays a thin wing servo in the wing's plane, its long
// side across the span. Any servo may lie flat; the thin wing servos are simply the ones built for it.
export const MOUNTINGS = { upright: 'Upright', side: 'On its side', flat: 'Flat (wing servo)' }

export function servoEnvelope(servo, mounting = 'upright') {
  const [l, w, h] = servo.body ?? [servo.length, servo.width, servo.height]
  if (mounting === 'side') return { chord: l, span: h, depth: w }
  if (mounting === 'flat') return { chord: h, span: l, depth: w }
  return { chord: l, span: w, depth: h }
}

// A catalogue entry by its id, or a generic class by its key (as { id, ...class }), or null
export function servoById(id) {
  const h = CATALOGUE.find((s) => s.id === id)
  if (h) return h
  if (SERVOS[id]) return { id, ...SERVOS[id] }
  return null
}

// The picker's choices: the generic classes, then each maker's servos, a group per class from the
// smallest up and the thin wing servos last (each group in one run, as the drop-down needs)
export function servoOptions() {
  const makers = [...new Set(CATALOGUE.map((s) => s.maker))]
  const rank = (s) => makers.indexOf(s.maker) * 10 + (s.thin ? SERVO_CLASSES.length : SERVO_CLASSES.indexOf(s.class))
  return [
    ...SERVO_CLASSES.map((cls) => ({ value: cls, label: `${SERVOS[cls].label} (${SERVOS[cls].size})`, group: 'Generic' })),
    ...[...CATALOGUE].sort((a, b) => rank(a) - rank(b)).map((s) => ({
      value: s.id,
      label: `${s.model}, ${Math.round(s.mass * 1000)} g, ${(s.torque / KG_CM).toFixed(1)} kg·cm${s.current === false ? ' (discontinued)' : ''}`,
      group: s.thin ? `${s.maker} wing servos (thin)` : `${s.maker} ${SERVOS[s.class].label.toLowerCase()}`,
    })),
  ]
}
// Gap kept between ribs and plate rim, hatch margin and the like, m
export const BAY_MARGIN = 0.003

// The class that suits a model of this all-up mass (kg) when none's chosen: what wing servos
// of that size usually are. Sub-micro up to 0.6 kg, micro to 2.5 kg, mini to 6 kg, standard
// beyond.
export function defaultServoClass(mass) {
  if (!(mass > 0) || mass <= 0.6) return mass > 0 ? 'sub-micro' : 'micro'
  if (mass <= 2.5) return 'micro'
  if (mass <= 6) return 'mini'
  return 'standard'
}

export const servoOf = (cls) => SERVOS[cls] ?? SERVOS.micro

// The servo a bay holds, in the generic classes' fields (which the bay geometry reads) and turned
// to its mounting, sized by everything drawn of it (servoParts: case, tower, lugs, output boss and
// lead stub), so a bay that fits these fits the whole servo:
//   length         the case along the chord
//   caseWidth      the case across the span
//   run            the whole servo along the chord, symmetric about the case's centre (the bay's
//                  lug run, what the stretch between the spar and the hinge must hold)
//   width          the whole servo across the span, symmetric about the bay's centre
//   height         the whole servo's depth, from its lowest point to its highest
//   lift           how far the case's base sits above that lowest point (a wing servo's tab,
//                  or a lead out of the base, stood upright)
//   lugHeight      from the lowest point to the underside of the plate's lugs (the plate's
//                  underside is lugHeight + lugThickness)
//   lugSpan        the lugs' own span, as drawn
//   plan           the mount plate's cut-out ({ x, s } ranges, from the case's centre and the
//                  bay's: the bounding box of cutPoly), cutPoly (the cut-out's corners, [x, s],
//                  turned with the servo) and its screw holes ([x, s]), see platePlan
//   outline        the whole servo's outline in plan, [x, s] corners from the case's centre
//   caseOutline    the case's, likewise
//   quarter, yaw   how it's turned in plan (turn)
// id is a Hitec id or a class; anything else takes the class that suits the model's mass. turn:
// { quarter, yaw }, the servo turned in plan about its case's centre: a quarter turn (its length
// across the span rather than along the chord), then yaw radians more (anticlockwise from above,
// x towards s), as a bay square to its hinge is.
export function installedServo(id, mounting = 'upright', mass = 0, turn = {}) {
  const found = servoById(id) ?? { id: defaultServoClass(mass), ...SERVOS[defaultServoClass(mass)] }
  const cls = SERVOS[found.class] ?? SERVOS[found.id] ?? SERVOS.micro
  const frame = servoFrame(found)
  const mount = MOUNTINGS[mounting] ? mounting : 'upright'
  const yaw = Number.isFinite(turn.yaw) ? turn.yaw : 0
  const base = {
    ...cls,
    ...found,
    label: found.model ?? cls.label,
    lugSpan: frame.lugSpan,
    lugThickness: frame.lugThickness,
    frame,
    mounting: mount,
    quarter: !!turn.quarter,
    yaw,
    lift: 0,
  }
  // Placed about the case's centre on its base, to measure it: square (the plate's cut-out and
  // screws are worked out so, then turned) and turned (its extents)
  const square = placeServo({ ...base, yaw: 0 }, { x: 0, s: 0, base: 0 })
  const parts = placeServo(base, { x: 0, s: 0, base: 0 })
  const ext = partsExtent(parts)
  const sq = partsExtent(square)
  const kase = square[0].box
  const lift = -ext.z[0]
  const plateZ = plateHeight(square, frame.lugThickness, ext.z) + lift
  const flat = platePlan(square, plateZ - lift, cls.plate, found.pilot ?? cls.pilot)
  const rot = ([x, q]) => turnPoint([x, q], yaw)
  const rect = (xs, ss) => [[xs[0], ss[0]], [xs[1], ss[0]], [xs[1], ss[1]], [xs[0], ss[1]]].map(rot)
  const cutPoly = flat.cut ? rect(flat.cut.x, flat.cut.s) : null
  const plan = {
    cut: cutPoly ? { x: rangeOf(cutPoly, 0), s: rangeOf(cutPoly, 1) } : null,
    cutPoly,
    screws: flat.screws.map(rot),
    short: flat.short,
  }
  return {
    ...base,
    length: kase.x[1] - kase.x[0],
    caseWidth: kase.s[1] - kase.s[0],
    run: 2 * Math.max(-ext.x[0], ext.x[1]),
    width: 2 * Math.max(-ext.s[0], ext.s[1]),
    // The bay between the rib faces: the servo and its clearance, or the plate's cut-out and its
    // edge of ply where turning the servo takes the cut-out's corners further
    bayWidth: Math.max(2 * Math.max(-ext.s[0], ext.s[1]) + 2 * SERVO_CLEARANCE, plan.cut ? 2 * Math.max(-plan.cut.s[0], plan.cut.s[1]) + 2 * PLATE_EDGE : 0),
    height: ext.z[1] - ext.z[0],
    lift,
    lugHeight: plateZ - frame.lugThickness,
    plan,
    outline: rect(sq.x, sq.s),
    caseOutline: rect(kase.x, kase.s),
  }
}

// [x, s] turned by yaw about the origin (anticlockwise from above, x towards s)
export const turnPoint = ([x, q], yaw) => (yaw ? [x * Math.cos(yaw) - q * Math.sin(yaw), x * Math.sin(yaw) + q * Math.cos(yaw)] : [x, q])
const rangeOf = (pts, k) => [Math.min(...pts.map((p) => p[k])), Math.max(...pts.map((p) => p[k]))]

// The x, s and z ranges a set of placed parts (placeServo) fill
export function partsExtent(parts) {
  const ext = { x: [Infinity, -Infinity], s: [Infinity, -Infinity], z: [Infinity, -Infinity] }
  const grow = (k, lo, hi) => {
    ext[k][0] = Math.min(ext[k][0], lo)
    ext[k][1] = Math.max(ext[k][1], hi)
  }
  for (const p of parts) {
    if (p.turn) {
      const c = planCorners(p)
      grow('x', ...rangeOf(c, 0))
      grow('s', ...rangeOf(c, 1))
      const z = partRanges(p).z
      grow('z', z[0], z[1])
    } else if (p.box) for (const k of ['x', 's', 'z']) grow(k, p.box[k][0], p.box[k][1])
    else {
      const c = p.cylinder
      for (const k of ['x', 's', 'z']) {
        if (k === c.axis) grow(k, c.from, c.to)
        else grow(k, c[k] - c.r, c[k] + c.r)
      }
    }
  }
  return ext
}

// The ranges one part fills in x, s and z
function partRanges(p) {
  if (p.box) return p.box
  const c = p.cylinder
  const r = (k) => (k === c.axis ? [c.from, c.to] : [c[k] - c.r, c[k] + c.r])
  return { x: r('x'), s: r('s'), z: r('z') }
}

// The height of the mount plate's underside (placed parts, the case on z = 0): the top of the
// lugs that lie flat in the wing's plane (an upright servo's, or a wing servo's laid flat),
// the highest of them; with none lying flat (an ordinary servo on its side or flat, whose lugs
// stand on edge), half way up the servo.
function plateHeight(parts, t, zs) {
  const flat = parts.slice(1).filter((p) => p.kind === 'servo' && p.box && Math.abs(p.box.z[1] - p.box.z[0] - t) < 1e-6)
  if (flat.length) return Math.max(...flat.map((p) => p.box.z[1]))
  return (zs[0] + zs[1]) / 2
}

// The mount plate's cut-out and screw holes, from the case's centre (x) and the bay's (s): the
// cut-out is the plan of everything that passes through the plate (from z to z + thickness)
// with CUTOUT_GAP round it; a screw goes through each lug that bears on the plate's underside,
// in the part of the lug the cut-out leaves (so the ply either side of the hole is even), two
// along it when that part is at least 8 mm long, at a quarter of its length from its middle,
// else one at its middle, leaving out any the cut-out would take or that would leave less than
// SCREW_EDGE of ply between its pilot hole and the cut-out (short says some were left out).
export function platePlan(parts, z, thickness, pilot = 0.001) {
  const through = parts.filter((p) => {
    const r = partRanges(p)
    return r.z[0] < z + thickness - 1e-6 && r.z[1] > z + 1e-6
  })
  const ext = partsExtent(through)
  const cut = through.length ? { x: [ext.x[0] - CUTOUT_GAP, ext.x[1] + CUTOUT_GAP], s: [ext.s[0] - CUTOUT_GAP, ext.s[1] + CUTOUT_GAP] } : null
  const inCut = ([x, s]) => cut && x > cut.x[0] && x < cut.x[1] && s > cut.s[0] && s < cut.s[1]
  // A lug's range on one axis with the cut-out's taken off the end it covers
  const clip = (r, c) => (!c || r[1] <= c[0] || r[0] >= c[1] ? r : r[1] > c[1] ? [Math.max(r[0], c[1]), r[1]] : r[0] < c[0] ? [r[0], Math.min(r[1], c[0])] : r)
  const screws = []
  let short = false
  for (const p of parts.slice(1)) {
    if (p.kind !== 'servo' || !p.box || Math.abs(p.box.z[1] - z) > 1e-6) continue
    // Clip along the axis the lug sticks out of the cut-out on
    const outX = cut && (p.box.x[0] < cut.x[0] || p.box.x[1] > cut.x[1])
    const x = outX ? clip(p.box.x, cut.x) : p.box.x
    const s = !outX && cut ? clip(p.box.s, cut.s) : p.box.s
    const mid = [(x[0] + x[1]) / 2, (s[0] + s[1]) / 2]
    const lx = x[1] - x[0]
    const ls = s[1] - s[0]
    const pts = Math.max(lx, ls) < 0.008 ? [mid] : lx > ls ? [[mid[0] - lx / 4, mid[1]], [mid[0] + lx / 4, mid[1]]] : [[mid[0], mid[1] - ls / 4], [mid[0], mid[1] + ls / 4]]
    for (const q of pts) {
      if (inCut(q)) continue
      // Room for the pilot hole and SCREW_EDGE of ply to the cut-out, or none
      if (cut && Math.max(cut.x[0] - q[0], q[0] - cut.x[1], cut.s[0] - q[1], q[1] - cut.s[1]) - pilot / 2 < SCREW_EDGE - 1e-9) {
        short = true
        continue
      }
      screws.push(q)
    }
  }
  return { cut, screws, short }
}

// A servo's shape in its own frame, upright: x along its length from the case's centre
// (positive towards the lead end), y across its width from the centre, z up from its base.
// From an entry's drawn figures, or for a generic class from its sizes, with the output boss a
// quarter of the length from the centre, a third of the width across and an eighth of the
// height above the case, and the lead out of the end near the base. An entry with a case but no
// drawing (a Futaba servo: see `estimated`) takes the rest from its class, the lug span scaled
// with its length.
export function servoFrame(servo) {
  const cls = SERVOS[servo.class] ?? SERVOS[servo.id] ?? SERVOS.micro
  const [length, width, height] = servo.body ?? [servo.length ?? cls.length, servo.width ?? cls.width, servo.height ?? cls.height]
  const out = {
    length,
    width,
    height,
    caseHeight: servo.caseHeight ?? height,
    lugSpan: servo.lugSpan ?? (servo.body ? (length * cls.lugSpan) / cls.length : cls.lugSpan),
    lugThickness: servo.lugThickness ?? cls.lugThickness,
    lugHeight: servo.lugHeight ?? (height * cls.lugHeight) / cls.height,
    output: servo.output ?? { offset: length / 4, top: height * 1.125, diameter: width / 3 },
    lead: servo.lead ?? { exit: 'end', at: Math.min(0.004, height / 5) },
  }
  if (servo.wingLugs) out.wingLugs = servo.wingLugs
  return out
}

// How thick a servo's lead is drawn, and how far it's drawn out of the case, m
const LEAD = { thickness: 0.002, stub: 0.006 }

// The solids a servo is drawn with, in its frame (servoFrame): { kind, box } with box
// [[x0, x1], [y0, y1], [z0, z1]], or { kind, cylinder } with cylinder { x, y, r, z: [z0, z1] }
// standing on the z axis. kind is 'servo' for the case, gear tower and lugs, 'servoOutput' for
// the output boss and 'servoLead' for the lead's stub. The case comes first.
export function servoParts(frame) {
  const { length: l, width: w, height: h, caseHeight, lugSpan, lugThickness: t, lugHeight, output, lead, wingLugs } = frame
  const parts = [{ kind: 'servo', box: [[-l / 2, l / 2], [-w / 2, w / 2], [0, caseHeight]] }]
  if (h > caseHeight + 1e-6) parts.push({ kind: 'servo', cylinder: { x: output.offset, y: 0, r: w / 2, z: [caseHeight, h] } })
  // The lugs either end, beyond the case: lying across its width at their height, or a wing
  // servo's standing in its middle, a pair at the top and a pair or a tab at the bottom
  const ends = [[-lugSpan / 2, -l / 2], [l / 2, lugSpan / 2]]
  if (wingLugs) {
    const thin = [-t / 2, t / 2]
    for (const x of ends) parts.push({ kind: 'servo', box: [x, thin, [h - wingLugs.length, h]] })
    if (wingLugs.bottom === 'tab') parts.push({ kind: 'servo', box: [[-wingLugs.tab[0] / 2, wingLugs.tab[0] / 2], thin, [-wingLugs.tab[1], 0]] })
    else for (const x of ends) parts.push({ kind: 'servo', box: [x, thin, [0, wingLugs.length]] })
  } else {
    for (const x of ends) parts.push({ kind: 'servo', box: [x, [-w / 2, w / 2], [lugHeight, lugHeight + t]] })
  }
  parts.push({ kind: 'servoOutput', cylinder: { x: output.offset, y: 0, r: output.diameter / 2, z: [h, Math.max(h, output.top)] } })
  const d = LEAD.thickness / 2
  if (lead.exit === 'base') parts.push({ kind: 'servoLead', box: [[lead.at - d, lead.at + d], [-d, d], [-LEAD.stub, 0]] })
  else parts.push({ kind: 'servoLead', box: [[l / 2, l / 2 + LEAD.stub], [-d, d], [lead.at - d, lead.at + d]] })
  return parts
}

// A bay's servo drawn in the wing: servoParts turned to the bay's mounting and placed, as
// { kind, box } with box { x: [x0, x1], s: [s0, s1], z: [z0, z1] } (plan x along the chord,
// flat s along the span, z the height in the section), or { kind, cylinder } with cylinder
// { axis: 'x' | 's' | 'z', x, s, z (the centre, the axis's own one unused), r, from, to }.
// at: { x, s, base }, the case's centre along the chord, the bay's centre across the span (the
// case's too) and the height the servo stands on (its lowest point; the case's base is lift
// above it). Upright, its length runs along the chord with the lead end aft; on its side, the
// same with its height across the span; flat, its height runs along the chord, output aft, and
// its length across the span. A quarter turn (servo.quarter) turns all that a quarter about the
// case's centre, exactly, so boxes stay boxes; a yaw (servo.yaw, radians) more is carried by
// each part as turn { yaw, x, s }, the turn about the case's centre its box or cylinder is to
// be drawn with (planCorners, turnedSlice).
export function placeServo(servo, at) {
  const f = servo.frame ?? servoFrame(servo)
  const m = mountMap(servo.mounting, f)
  const origin = { x: at.x, s: at.s, z: at.base + (servo.lift ?? 0) }
  const idx = { x: 0, y: 1, z: 2 }
  const range = (axis, box) => {
    const [from, by] = m[axis]
    return box[idx[from]].map((v) => origin[axis] + by + v)
  }
  const point = (axis, p) => {
    const [from, by] = m[axis]
    return origin[axis] + by + p[from]
  }
  const yaw = servo.yaw ?? 0
  const turn = Math.abs(yaw) > 1e-9 ? { yaw, x: at.x, s: at.s } : null
  return servoParts(f).map((p) => {
    let out
    if (p.box) out = { kind: p.kind, box: { x: range('x', p.box), s: range('s', p.box), z: range('z', p.box) } }
    else {
      const c = p.cylinder
      const axis = Object.keys(m).find((k) => m[k][0] === 'z')
      const centre = { x: c.x, y: c.y, z: 0 }
      const [from, to] = c.z.map((v) => origin[axis] + m[axis][1] + v)
      out = { kind: p.kind, cylinder: { axis, x: point('x', centre), s: point('s', centre), z: point('z', centre), r: c.r, from, to } }
    }
    if (servo.quarter) out = quarterTurn(out, at)
    return turn ? { ...out, turn } : out
  })
}

// Frame (x along the case, y across it, z up its height) to wing (x, s, z) for a mounting: which
// frame axis each wing axis takes, and the offset from the case's centre on its base
function mountMap(mounting, f) {
  if (mounting === 'side') return { x: ['x', 0], s: ['z', -f.height / 2], z: ['y', f.width / 2] }
  if (mounting === 'flat') return { x: ['z', -f.height / 2], s: ['x', 0], z: ['y', f.width / 2] }
  return { x: ['x', 0], s: ['y', 0], z: ['z', 0] }
}

// A placed part turned a quarter (x towards s) about at, exactly: x' = at.x - (s - at.s),
// s' = at.s + (x - at.x)
function quarterTurn(p, at) {
  const X = (s) => at.x - (s - at.s)
  const S = (x) => at.s + (x - at.x)
  if (p.box) return { ...p, box: { x: [X(p.box.s[1]), X(p.box.s[0])], s: [S(p.box.x[0]), S(p.box.x[1])], z: p.box.z } }
  const c = p.cylinder
  const axis = c.axis === 'x' ? 's' : c.axis === 's' ? 'x' : 'z'
  const [from, to] = c.axis === 'x' ? [S(c.from), S(c.to)] : c.axis === 's' ? [X(c.to), X(c.from)] : [c.from, c.to]
  return { ...p, cylinder: { ...c, axis, x: X(c.s), s: S(c.x), from, to } }
}

// A point or a direction in the servo's own frame (servoFrame: x along the case towards the
// lead end, y across it, z up its height from the base, about the case's centre) in the wing,
// placed as placeServo places it.
export function servoPoint(servo, at, p) {
  const f = servo.frame ?? servoFrame(servo)
  const m = mountMap(servo.mounting, f)
  const idx = { x: 0, y: 1, z: 2 }
  const local = ['x', 's', 'z'].map((k) => m[k][1] + p[idx[m[k][0]]])
  const [x, q] = planTurn(servo, [local[0], local[1]])
  return [at.x + x, at.s + q, at.base + (servo.lift ?? 0) + local[2]]
}
export function servoDir(servo, d) {
  const m = mountMap(servo.mounting, servo.frame ?? servoFrame(servo))
  const idx = { x: 0, y: 1, z: 2 }
  const local = ['x', 's', 'z'].map((k) => d[idx[m[k][0]]])
  const [x, q] = planTurn(servo, [local[0], local[1]])
  return [x, q, local[2]]
}
const planTurn = (servo, p) => turnPoint(turnPoint(p, servo.quarter ? Math.PI / 2 : 0), servo.yaw ?? 0)

// A placed part's outline in plan, [x, s] corners, turned with it: a box's, or the rectangle a
// cylinder covers in plan
export function planCorners(p) {
  const r = partRanges(p.turn ? { ...p, turn: null } : p)
  const pts = [[r.x[0], r.s[0]], [r.x[1], r.s[0]], [r.x[1], r.s[1]], [r.x[0], r.s[1]]]
  if (!p.turn) return pts
  return pts.map(([x, q]) => {
    const [dx, ds] = turnPoint([x - p.turn.x, q - p.turn.s], p.turn.yaw)
    return [p.turn.x + dx, p.turn.s + ds]
  })
}

// Where a convex outline in plan ([x, s] corners) crosses the line at s: its [x0, x1], or null
export function xRangeAt(poly, s) {
  const xs = []
  for (let i = 0; i < poly.length; i++) {
    const [xa, sa] = poly[i]
    const [xb, sb] = poly[(i + 1) % poly.length]
    if ((sa - s) * (sb - s) > 0 || sa === sb) {
      if (sa === sb && Math.abs(sa - s) < 1e-12) xs.push(xa, xb)
      continue
    }
    xs.push(xa + ((xb - xa) * (s - sa)) / (sb - sa))
  }
  return xs.length ? [Math.min(...xs), Math.max(...xs)] : null
}

// One placed part cut square to the span at s, as [x, z] corners, or null where the cut misses
// it. A turned part is cut through its turned outline: a box's or an upright cylinder's
// exactly; a cylinder lying in the wing's plane as its circle carried along its turned axis
// (lying across the span) or as the box round it (along the chord).
export function partSlice(p, s) {
  const rect = (x0, x1, z0, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]
  const c = p.cylinder
  if (!p.turn) {
    if (p.box) return s >= p.box.s[0] && s <= p.box.s[1] ? rect(p.box.x[0], p.box.x[1], p.box.z[0], p.box.z[1]) : null
    if (c.axis === 's') {
      if (s < c.from || s > c.to) return null
      return ring(c.x, c.z, c.r)
    }
    const d = s - c.s
    if (Math.abs(d) >= c.r) return null
    const half = Math.sqrt(c.r * c.r - d * d)
    return c.axis === 'x' ? rect(c.from, c.to, c.z - half, c.z + half) : rect(c.x - half, c.x + half, c.from, c.to)
  }
  const t = p.turn
  const about = ([x, q]) => {
    const [dx, ds] = turnPoint([x - t.x, q - t.s], t.yaw)
    return [t.x + dx, t.s + ds]
  }
  if (c?.axis === 'z') {
    const [cx, cs] = about([c.x, c.s])
    const d = s - cs
    if (Math.abs(d) >= c.r) return null
    const half = Math.sqrt(c.r * c.r - d * d)
    return rect(cx - half, cx + half, c.from, c.to)
  }
  const x = xRangeAt(planCorners(p), s)
  if (!x) return null
  if (c?.axis === 's') {
    // The axis turned: its centre at s
    const [x0, s0] = about([c.x, c.from])
    const [x1, s1] = about([c.x, c.to])
    const cx = Math.abs(s1 - s0) < 1e-12 ? x0 : x0 + ((x1 - x0) * (s - s0)) / (s1 - s0)
    // No further than its outline in plan, near its turned ends
    return ring(cx, c.z, c.r).map(([px, pz]) => [Math.min(x[1], Math.max(x[0], px)), pz])
  }
  const z = partRanges({ ...p, turn: null }).z
  return rect(x[0], x[1], z[0], z[1])
}
const ring = (x, z, r) => Array.from({ length: 16 }, (_, i) => [x + r * Math.cos((2 * Math.PI * i) / 16), z + r * Math.sin((2 * Math.PI * i) / 16)])

// The span a placed part covers, [s0, s1]
export function partSpan(p) {
  if (!p.turn) return partRanges(p).s
  return rangeOf(planCorners(p), 1)
}

// The settings for a surface's bay: the saved ones over the defaults.
export function bayOf(controls, surfaceId) {
  const saved = (controls?.bays ?? []).find((b) => b.surface === surfaceId)
  return { surface: surfaceId, enabled: true, class: null, mounting: 'side', square: 'chord', quarterTurn: false, along: null, at: null, link: null, ...(saved ?? {}) }
}

// controls with one surface's bay settings changed. Settings that come back to the defaults
// are dropped, so the saved list stays only what was chosen.
export function setBay(controls, surfaceId, patch) {
  const next = { ...bayOf(controls, surfaceId), ...patch }
  const rest = (controls.bays ?? []).filter((b) => b.surface !== surfaceId)
  const side = !next.mounting || next.mounting === 'side'
  const link = next.link && Object.keys(next.link).length ? next.link : null
  const hinge = next.square === 'hinge'
  const same = next.enabled && !next.class && side && !hinge && !next.quarterTurn && !Number.isFinite(next.along) && !Number.isFinite(next.at) && !link
  const entry = { surface: surfaceId }
  if (!next.enabled) entry.enabled = false
  if (next.class) entry.class = next.class
  if (!side) entry.mounting = next.mounting
  if (hinge) entry.square = 'hinge'
  if (next.quarterTurn) entry.quarterTurn = true
  if (Number.isFinite(next.along)) entry.along = next.along
  if (Number.isFinite(next.at)) entry.at = next.at
  if (link) entry.link = link
  return { ...controls, bays: same ? rest : [...rest, entry] }
}

// controls without the bay settings of a surface that's gone
export const dropBay = (controls, surfaceId) => ({ ...controls, bays: (controls.bays ?? []).filter((b) => b.surface !== surfaceId) })

// Where each enabled bay goes, one per placed host (surfaces: resolveSurfaces output, and
// air brakes' hosts from airBrakes.js brakeHosts): its servo, its centre s (flat along the
// span), the two ribs either side (sA, sB, their centres, a rib thickness t out from the
// servo's width plus its clearance) and the gap between the ribs' faces (width). A control
// surface's bay is `along` from the surface's inner end when set, else (for an older save) `at`
// from the panel's inner end, else a third of the way out along it (where the linkage is short
// and the surface stiff); an air brake's goes beside its box, its outer rib the box's
// inner one, or failing that on the box's outer side. Named SB1, SB2 … root outward. ok is
// false, with a problem, if it can't be placed: 'surface' (its host isn't built), 'span' (the
// ribs would be off the panel) or 'overlap' (it clashes with a bay before it). beyond says it
// sticks out past the ends of its surface. Only the ok ones are built and weighed.
export function placeBays({ sampler, surfaces, controls, mass, ribThickness = 0.002 }) {
  const out = []
  const idOrder = (a, b) => (typeof a.id === 'number' && typeof b.id === 'number' ? a.id - b.id : String(a.id ?? '').localeCompare(String(b.id ?? ''), undefined, { numeric: true }))
  const order = [...(surfaces ?? [])].sort((a, b) => (a.s0 ?? Infinity) - (b.s0 ?? Infinity) || idOrder(a, b))
  const t = Math.max(0, ribThickness)
  const placed = []
  for (const r of order) {
    const cfg = bayOf(controls, r.id)
    if (!cfg.enabled) continue
    const chosen = servoById(cfg.class)
    const cls = chosen ? cfg.class : defaultServoClass(mass)
    // Square to the hinge: its length turned from the chord by the hinge line's angle in plan
    const yaw = cfg.square === 'hinge' && Number.isFinite(r.slope) ? -Math.atan(r.slope) : 0
    const servo = installedServo(cls, cfg.mounting, mass, { quarter: !!cfg.quarterTurn, yaw })
    const bay = { id: r.id, surface: r.id, hostLabel: r.label ?? '', brake: !!r.beside, label: '', name: '', class: cls, auto: !chosen, servo, mass: servo.mass, ok: false, problem: null }
    out.push(bay)
    if (!r.ok) {
      bay.problem = 'surface'
      continue
    }
    const p = sampler.ends[r.panelIndex]
    const width = servo.bayWidth ?? servo.width + 2 * SERVO_CLEARANCE
    const half = width / 2 + t / 2
    const centres = !r.beside && Number.isFinite(cfg.along) ? [r.s0 + cfg.along] : Number.isFinite(cfg.at) ? [p.inner.s + cfg.at] : r.beside ? [r.beside[0] - half, r.beside[1] + half] : [r.s0 + (r.s1 - r.s0) / 3]
    for (const s of centres) {
      Object.assign(bay, { s, sA: s - half, sB: s + half, width, panelIndex: r.panelIndex, rib: t, problem: null })
      // Ribs inside the panel, a few millimetres clear of its ends (which have ribs of their own)
      if (bay.sA < p.inner.s + 0.005 || bay.sB > p.outer.s - 0.005) {
        bay.problem = 'span'
        continue
      }
      bay.beyond = !r.beside && (bay.sA < r.s0 - 1e-6 || bay.sB > r.s1 + 1e-6)
      if (placed.some((q) => bay.sA < q.sB + 0.005 && bay.sB > q.sA - 0.005)) {
        bay.problem = 'overlap'
        continue
      }
      break
    }
    if (bay.problem) continue
    bay.ok = true
    placed.push(bay)
  }
  out.forEach((b, i) => {
    b.name = `SB${i + 1}`
    b.label = `Servo bay ${b.name}`
  })
  return out
}

// Servo trays between the wing's own ribs: for each built control-surface bay, the two ribs of
// `ribs` (rib stations, { s }, laid out without the bays) either side of its servo, when the
// servo and its clearance fit between their faces with no rib in the way. Returns a Map of bay
// id -> { sA, sB, width } for the bays that fit; the others keep ribs of their own. An air
// brake's bay shares the brake's box rib, so it's left as it is.
export function fitBaysToRibs(bays, ribs, ribThickness = 0) {
  const out = new Map()
  const t = Math.max(0, ribThickness)
  const sorted = [...(ribs ?? [])].sort((p, q) => p.s - q.s)
  for (const b of bays ?? []) {
    if (!b.ok || b.brake) continue
    const half = (b.servo.bayWidth ?? b.servo.width + 2 * SERVO_CLEARANCE) / 2 + t / 2
    const inner = [...sorted].reverse().find((r) => r.s <= b.s - half + 1e-9)
    const outer = sorted.find((r) => r.s >= b.s + half - 1e-9)
    if (!inner || !outer) continue
    // Only between neighbouring ribs: a rib between them would run through the servo
    if (sorted.some((r) => r.s > inner.s + 1e-6 && r.s < outer.s - 1e-6)) continue
    out.set(b.id, { sA: inner.s, sB: outer.s, width: outer.s - inner.s - t })
  }
  return out
}

// The servos' masses and where they hang along the half wing, for the bending check:
// [{ s, mass, name }] for the bays that are built (ok).
export const servoMasses = (bays) => (bays ?? []).filter((b) => b.ok).map((b) => ({ s: b.s, mass: b.mass, name: b.name }))
