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
//   mounting  'upright' (default), 'side' or 'flat': see MOUNTINGS
//   along     where its centre is, m from the surface's inner end (surface.from), along the
//             surface; null for a third of the way out along it
//   at        the older panel-relative position, m from the panel's inner end; used only when
//             along is not set (saves from before along)

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
  },
}

export const SERVO_CLASSES = Object.keys(SERVOS)

// Room left round the case in the bay, each side across the span, m
export const SERVO_CLEARANCE = 0.0015
// The top of the case's clearance under the upper skin, m
export const SERVO_HEADROOM = 0.002

// ---------------------------------------------------------------------------------------------
// Hitec catalogue. Figures are NOT yet checked against Hitec's datasheets: they were entered
// from memory and need confirming before the entries are relied on. Each entry is a real
// servo; the generic classes above remain the fallback. Units are converted here: mm to m,
// g to kg, kg·cm to N·m.
//
//   id, model, maker   the picker's id ('hitec-' + the model), the model name, 'Hitec'
//   class              the generic class it's sized as, for plate and lead hole
//   body               [length, width, height] of the case, m: length along the chord,
//                      width across the span, height from base to top (the order printed
//                      on Hitec's pages, assumed; check against a drawing)
//   lugSpan            the mounting lugs' overall length, m. Hitec publishes no tab span, so
//                      this is the body length plus 2 x 4 mm (sub-micro and micro), 5 mm (mini)
//                      or 7 mm (standard); lugEstimated says so
//   mass               with its lead, kg
//   torque             stall torque at about 4.8 to 6 V, N·m
//   thin               a thin wing servo, the kind that lies flat in a thin wing
//   plate, leadHole    from the generic class above
//
// Dropped: HS-422, discontinued. HS-75BB is a retract servo, so it isn't listed; HS-50, HS-82MG
// and HS-325HB had no published figures to hand. Body sizes and torques checked against
// hitecrcd.com in October 2026 (torque the higher, 6 V, figure where both are given).
const KG_CM = 0.0980665
const fromClass = (cls) => ({ plate: SERVOS[cls].plate, leadHole: SERVOS[cls].leadHole })

export const HITEC = [
  { id: 'hitec-hs-65mg', model: 'HS-65MG', maker: 'Hitec', class: 'micro', body: [0.0236, 0.0116, 0.024], lugSpan: 0.0316, lugEstimated: true, mass: 0.0119, torque: 2.2 * KG_CM, thin: false, ...fromClass('micro') },
  { id: 'hitec-hs-5070mh', model: 'HS-5070MH', maker: 'Hitec', class: 'micro', body: [0.0236, 0.0116, 0.03], lugSpan: 0.0316, lugEstimated: true, mass: 0.0127, torque: 3.1 * KG_CM, thin: false, ...fromClass('micro') },
  { id: 'hitec-hs-5085mg', model: 'HS-5085MG', maker: 'Hitec', class: 'micro', body: [0.029, 0.013, 0.0294], lugSpan: 0.037, lugEstimated: true, mass: 0.0219, torque: 4.3 * KG_CM, thin: false, ...fromClass('micro') },
  { id: 'hitec-hs-85mg', model: 'HS-85MG', maker: 'Hitec', class: 'micro', body: [0.029, 0.013, 0.03], lugSpan: 0.037, lugEstimated: true, mass: 0.0219, torque: 3.5 * KG_CM, thin: false, ...fromClass('micro') },
  { id: 'hitec-d89mw', model: 'D89MW', maker: 'Hitec', class: 'micro', body: [0.029, 0.013, 0.03], lugSpan: 0.037, lugEstimated: true, mass: 0.025, torque: 8.5 * KG_CM, thin: false, ...fromClass('micro') },
  { id: 'hitec-hs-81', model: 'HS-81', maker: 'Hitec', class: 'micro', body: [0.0298, 0.012, 0.0296], lugSpan: 0.0378, lugEstimated: true, mass: 0.0166, torque: 3.0 * KG_CM, thin: false, ...fromClass('micro') },
  { id: 'hitec-hs-5125mg', model: 'HS-5125MG', maker: 'Hitec', class: 'mini', body: [0.03, 0.01, 0.034], lugSpan: 0.04, lugEstimated: true, mass: 0.024, torque: 3.5 * KG_CM, thin: true, ...fromClass('mini') },
  { id: 'hitec-hs-125mg', model: 'HS-125MG', maker: 'Hitec', class: 'mini', body: [0.03, 0.01, 0.034], lugSpan: 0.04, lugEstimated: true, mass: 0.024, torque: 3.5 * KG_CM, thin: true, ...fromClass('mini') },
  { id: 'hitec-d131mw', model: 'D131MW', maker: 'Hitec', class: 'micro', body: [0.022, 0.0085, 0.0232], lugSpan: 0.03, lugEstimated: true, mass: 0.0098, torque: 2.9 * KG_CM, thin: true, ...fromClass('micro') },
  { id: 'hitec-d141sw', model: 'D141SW', maker: 'Hitec', class: 'mini', body: [0.03, 0.01, 0.0295], lugSpan: 0.04, lugEstimated: true, mass: 0.026, torque: 7.0 * KG_CM, thin: true, ...fromClass('mini') },
  { id: 'hitec-d145sw', model: 'D145SW', maker: 'Hitec', class: 'mini', body: [0.03, 0.01, 0.037], lugSpan: 0.04, lugEstimated: true, mass: 0.024, torque: 6.0 * KG_CM, thin: true, ...fromClass('mini') },
  { id: 'hitec-hs-7115th', model: 'HS-7115TH', maker: 'Hitec', class: 'mini', body: [0.026, 0.008, 0.038], lugSpan: 0.036, lugEstimated: true, mass: 0.02, torque: 3.9 * KG_CM, thin: true, ...fromClass('mini') },
  { id: 'hitec-hs-225mg', model: 'HS-225MG', maker: 'Hitec', class: 'mini', body: [0.0324, 0.0168, 0.031], lugSpan: 0.0424, lugEstimated: true, mass: 0.031, torque: 4.8 * KG_CM, thin: false, ...fromClass('mini') },
  { id: 'hitec-hs-5245mg', model: 'HS-5245MG', maker: 'Hitec', class: 'mini', body: [0.0324, 0.0168, 0.0308], lugSpan: 0.0424, lugEstimated: true, mass: 0.032, torque: 5.5 * KG_CM, thin: false, ...fromClass('mini') },
  { id: 'hitec-hs-55', model: 'HS-55', maker: 'Hitec', class: 'micro', body: [0.0228, 0.0116, 0.024], lugSpan: 0.0308, lugEstimated: true, mass: 0.008, torque: 1.5 * KG_CM, thin: false, ...fromClass('micro') },
  { id: 'hitec-hs-65hb', model: 'HS-65HB', maker: 'Hitec', class: 'micro', body: [0.0236, 0.0116, 0.024], lugSpan: 0.0316, lugEstimated: true, mass: 0.0112, torque: 1.9 * KG_CM, thin: false, ...fromClass('micro') },
  { id: 'hitec-hs-5055mg', model: 'HS-5055MG', maker: 'Hitec', class: 'micro', body: [0.0228, 0.0116, 0.024], lugSpan: 0.0308, lugEstimated: true, mass: 0.0095, torque: 1.6 * KG_CM, thin: false, ...fromClass('micro') },
  { id: 'hitec-hs-5065mg', model: 'HS-5065MG', maker: 'Hitec', class: 'micro', body: [0.0236, 0.0116, 0.03], lugSpan: 0.0316, lugEstimated: true, mass: 0.0119, torque: 2.2 * KG_CM, thin: false, ...fromClass('micro') },
  { id: 'hitec-hs-85bb', model: 'HS-85BB', maker: 'Hitec', class: 'micro', body: [0.029, 0.013, 0.03], lugSpan: 0.037, lugEstimated: true, mass: 0.0192, torque: 3.5 * KG_CM, thin: false, ...fromClass('micro') },
  { id: 'hitec-hs-225bb', model: 'HS-225BB', maker: 'Hitec', class: 'mini', body: [0.0324, 0.0168, 0.031], lugSpan: 0.0424, lugEstimated: true, mass: 0.027, torque: 4.8 * KG_CM, thin: false, ...fromClass('mini') },
  { id: 'hitec-hs-77bb', model: 'HS-77BB', maker: 'Hitec', class: 'standard', body: [0.044, 0.023, 0.025], lugSpan: 0.058, lugEstimated: true, mass: 0.035, torque: 5.5 * KG_CM, thin: false, ...fromClass('standard') },
  { id: 'hitec-hs-311', model: 'HS-311', maker: 'Hitec', class: 'standard', body: [0.04, 0.02, 0.0365], lugSpan: 0.054, lugEstimated: true, mass: 0.043, torque: 3.7 * KG_CM, thin: false, ...fromClass('standard') },
  { id: 'hitec-hs-322hd', model: 'HS-322HD', maker: 'Hitec', class: 'standard', body: [0.04, 0.02, 0.0365], lugSpan: 0.054, lugEstimated: true, mass: 0.043, torque: 3.7 * KG_CM, thin: false, ...fromClass('standard') },
  { id: 'hitec-hs-485hb', model: 'HS-485HB', maker: 'Hitec', class: 'standard', body: [0.0398, 0.0198, 0.038], lugSpan: 0.0538, lugEstimated: true, mass: 0.045, torque: 6.0 * KG_CM, thin: false, ...fromClass('standard') },
  { id: 'hitec-hs-5485hb', model: 'HS-5485HB', maker: 'Hitec', class: 'standard', body: [0.0398, 0.0198, 0.038], lugSpan: 0.0538, lugEstimated: true, mass: 0.045, torque: 6.4 * KG_CM, thin: false, ...fromClass('standard') },
  { id: 'hitec-hs-625mg', model: 'HS-625MG', maker: 'Hitec', class: 'standard', body: [0.0406, 0.0198, 0.0378], lugSpan: 0.0546, lugEstimated: true, mass: 0.0552, torque: 6.8 * KG_CM, thin: false, ...fromClass('standard') },
  { id: 'hitec-hs-645mg', model: 'HS-645MG', maker: 'Hitec', class: 'standard', body: [0.0406, 0.0198, 0.0378], lugSpan: 0.0546, lugEstimated: true, mass: 0.0552, torque: 9.6 * KG_CM, thin: false, ...fromClass('standard') },
  { id: 'hitec-hs-5625mg', model: 'HS-5625MG', maker: 'Hitec', class: 'standard', body: [0.0408, 0.02, 0.0378], lugSpan: 0.0548, lugEstimated: true, mass: 0.06, torque: 9.4 * KG_CM, thin: false, ...fromClass('standard') },
  { id: 'hitec-hs-5645mg', model: 'HS-5645MG', maker: 'Hitec', class: 'standard', body: [0.04, 0.02, 0.0378], lugSpan: 0.054, lugEstimated: true, mass: 0.06, torque: 12.1 * KG_CM, thin: false, ...fromClass('standard') },
]

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

// A Hitec entry by its id, or a generic class by its key (as { id, ...class }), or null
export function servoById(id) {
  const h = HITEC.find((s) => s.id === id)
  if (h) return h
  if (SERVOS[id]) return { id, ...SERVOS[id] }
  return null
}

// The picker's choices: the generic classes, then the Hitec servos
export function servoOptions() {
  return [
    ...SERVO_CLASSES.map((cls) => ({ value: cls, label: `${SERVOS[cls].label} (${SERVOS[cls].size})`, group: 'Generic' })),
    ...HITEC.map((s) => ({
      value: s.id,
      label: `${s.model}, ${Math.round(s.mass * 1000)} g, ${(s.torque / KG_CM).toFixed(1)} kg·cm`,
      group: s.thin ? 'Hitec wing servos (thin)' : `Hitec ${SERVOS[s.class].label.toLowerCase()}`,
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
// to its mounting: length along the chord, width across the span, height its depth in the wing,
// and the lugs half way up a servo that lies down. id is a Hitec id or a class; anything else
// takes the class that suits the model's mass.
export function installedServo(id, mounting = 'upright', mass = 0) {
  const found = servoById(id) ?? { id: defaultServoClass(mass), ...SERVOS[defaultServoClass(mass)] }
  const cls = SERVOS[found.class] ?? SERVOS[found.id] ?? SERVOS.micro
  const [l, w, h] = found.body ?? [found.length, found.width, found.height]
  const base = {
    ...cls,
    ...found,
    label: found.model ?? cls.label,
    length: l,
    width: w,
    height: h,
    lugSpan: found.lugSpan ?? cls.lugSpan,
    lugThickness: cls.lugThickness,
    lugHeight: found.body ? (h * cls.lugHeight) / cls.height : cls.lugHeight,
  }
  const mount = MOUNTINGS[mounting] ? mounting : 'upright'
  if (mount === 'upright') return { ...base, mounting: mount }
  const e = servoEnvelope(found, mount)
  return { ...base, length: e.chord, width: e.span, height: e.depth, lugHeight: Math.max(0, e.depth / 2 - base.lugThickness / 2), mounting: mount }
}

// The settings for a surface's bay: the saved ones over the defaults.
export function bayOf(controls, surfaceId) {
  const saved = (controls?.bays ?? []).find((b) => b.surface === surfaceId)
  return { surface: surfaceId, enabled: true, class: null, mounting: 'upright', along: null, at: null, ...(saved ?? {}) }
}

// controls with one surface's bay settings changed. Settings that come back to the defaults
// are dropped, so the saved list stays only what was chosen.
export function setBay(controls, surfaceId, patch) {
  const next = { ...bayOf(controls, surfaceId), ...patch }
  const rest = (controls.bays ?? []).filter((b) => b.surface !== surfaceId)
  const upright = !next.mounting || next.mounting === 'upright'
  const same = next.enabled && !next.class && upright && !Number.isFinite(next.along) && !Number.isFinite(next.at)
  const entry = { surface: surfaceId }
  if (!next.enabled) entry.enabled = false
  if (next.class) entry.class = next.class
  if (!upright) entry.mounting = next.mounting
  if (Number.isFinite(next.along)) entry.along = next.along
  if (Number.isFinite(next.at)) entry.at = next.at
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
    const servo = installedServo(cls, cfg.mounting, mass)
    const bay = { id: r.id, surface: r.id, hostLabel: r.label ?? '', brake: !!r.beside, label: '', name: '', class: cls, auto: !chosen, servo, mass: servo.mass, ok: false, problem: null }
    out.push(bay)
    if (!r.ok) {
      bay.problem = 'surface'
      continue
    }
    const p = sampler.ends[r.panelIndex]
    const width = servo.width + 2 * SERVO_CLEARANCE
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
    const half = b.servo.width / 2 + SERVO_CLEARANCE + t / 2
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
