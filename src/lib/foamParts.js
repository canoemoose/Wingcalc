// The parts of a foam-core wing (foam.js), from the structure analysis: hot-wire templates for
// each panel's core, the skins and the sheets to cut them from, a shear web per panel, routing
// templates for the servo and air brake pockets, the foam blocks, and the core's weight.
//
// Hot-wire templates. Each panel's core is cut in one piece between a template at each end:
// the core's section at that end (between the skins, from the back of the leading edge stock
// to the front of the trailing edge stock), with the wing's twist and the sweep as they are
// at that end. Both templates of a pair are drawn in one frame: u along the chord (aft) and z
// up, from a common origin, so the level line (z = 0) and the vertical mark (u = 0) are the same
// line on both. Set the two templates on the block with the level lines the same height above
// its base and the marks on one line square across it, and the core comes out swept and twisted
// as designed. The outline is the section grown by half the wire's kerf all round, so the core
// comes out true size when the wire melts a cut that wide.
//
// Control surfaces aren't cut separately: the core is cut whole and skinned, and the surface is
// sawn off along its hinge line afterwards (marked on the templates where the line reaches the
// panel's end), each cut face then capped with its hinge spar as on a built-up wing. A surface
// rarely spans a whole panel, so separate cores would mean splitting the panel at its ends, and
// a core skinned whole keeps the surface true to the wing.
//
// Parts follow ribs.js: { id, name, group, material, thickness, qty, outline, holes, etch,
// guide (lines on the notes layer: the wire's lead-in and lead-out), label, notes }, metres.

import { MATERIALS, sparSection, lineFaces, sparWidth } from './structure.js'
import { skinSheet, TEMPLATE_THICKNESS, MIN_CORE } from './foam.js'
import { insetHeight } from './wing3d.js'
import { offsetContour } from './dxf.js'
import { polygonArea, bounds } from './ribs.js'

const RAD = Math.PI / 180
// Default wire settings, as in dxf.js defaultExportOptions
export const WIRE_KERF = 0.001
export const LEAD_IN = 0.02
// Margin of stock round a pocket's opening on its routing template
const POCKET_MARGIN = 0.025
// Foam block allowance beyond the core all round
const BLOCK_MARGIN = 0.01

const mmText = (v, dp = 1) => `${Number((v * 1000).toFixed(dp))} mm`
const cosine = (n) => Array.from({ length: n + 1 }, (_, i) => 0.5 * (1 - Math.cos((Math.PI * i) / n)))

// The core's section at s, in plan x and height h (with the twist, as the ribs and 3D view
// have it): between the skins' inner faces, from the back of the leading edge stock to the
// front of the trailing edge stock, stopping where the skins meet (less than MIN_CORE apart).
// Returns { upper, lower: [[x, h]] front to back, outline (closed: upper front to back, then
// lower back to front), x0, x1 } or null.
export function coreProfile(a, structure, s, n = 60) {
  const sec = a.section(s)
  if (!sec || !(sec.c > 1e-4)) return null
  const xa = sec.xl + Math.min(structure.le.width || 0, sec.c / 2)
  const xb = sec.xl + sec.c - Math.min(structure.te.width || 0, sec.c / 2)
  const upper = []
  const lower = []
  for (const f of cosine(n)) {
    const x = xa + (xb - xa) * f
    const up = insetHeight(a, structure, s, x, 'upper')
    const lo = insetHeight(a, structure, s, x, 'lower')
    if (up - lo < MIN_CORE) continue
    upper.push([x, up])
    lower.push([x, lo])
  }
  if (upper.length < 3) return null
  return { upper, lower, outline: [...upper, ...[...lower].reverse()], x0: upper[0][0], x1: upper.at(-1)[0] }
}

// The heights of a profile's surfaces at x (linear between its points), or null outside it.
function heightsAt(p, x) {
  const { upper, lower } = p
  if (x < upper[0][0] - 1e-12 || x > upper.at(-1)[0] + 1e-12) return null
  let i = 1
  while (i < upper.length - 1 && upper[i][0] < x) i++
  const t = (x - upper[i - 1][0]) / (upper[i][0] - upper[i - 1][0] || 1)
  return { up: upper[i - 1][1] + (upper[i][1] - upper[i - 1][1]) * t, lo: lower[i - 1][1] + (lower[i][1] - lower[i - 1][1]) * t }
}

// The common datum of a pair of profiles: the vertical mark's x, on both if their chords
// overlap (in the middle of the overlap, on a whole 5 mm), and the level line's height, in the
// middle of where both sections are at that x. common is false when the two don't overlap
// (extreme sweep), and each then gets its own.
export function pairDatum(pIn, pOut) {
  const lo = Math.max(pIn.x0, pOut.x0)
  const hi = Math.min(pIn.x1, pOut.x1)
  if (hi - lo > 0.01) {
    const mid = (lo + hi) / 2
    const snapped = Math.round(mid / 0.005) * 0.005
    const x = snapped > lo + 0.002 && snapped < hi - 0.002 ? snapped : mid
    const a = heightsAt(pIn, x)
    const b = heightsAt(pOut, x)
    const zLo = Math.max(a.lo, b.lo)
    const zHi = Math.min(a.up, b.up)
    if (zHi - zLo > 0.001) return { x, z: (zLo + zHi) / 2, common: true }
    return { x, z: (a.lo + a.up + b.lo + b.up) / 4, common: false }
  }
  return { x: null, z: null, common: false }
}

// One template: the core's section at s grown by half the kerf, in the pair's frame, with the
// level line, the vertical mark, chord ticks every tenth, the spar cap slots, the shear web,
// any hinge line, and the wire's lead-in (at the trailing edge) and lead-out (at the front) on
// the notes layer.
function template(a, structure, p, datum, { kerf, leadIn, s, surfaces }) {
  const x0 = datum.x ?? (p.x0 + p.x1) / 2
  const z0 = datum.z ?? (() => {
    const h = heightsAt(p, x0)
    return (h.up + h.lo) / 2
  })()
  const tr = ([x, h]) => [x - x0, h - z0]
  const outline = offsetContour(p.outline.map(tr), kerf / 2)
  const etch = []
  const line = (pts) => etch.push(pts.map(tr))
  // The level line, across the section where it's inside, 2 mm short of the outline
  const xs = p.upper.map(([x]) => x)
  const inside = xs.filter((x) => {
    const h = heightsAt(p, x)
    return h && h.lo + 0.001 < z0 && h.up - 0.001 > z0
  })
  if (inside.length >= 2 && inside.at(-1) - inside[0] > 0.006) line([[inside[0] + 0.002, z0], [inside.at(-1) - 0.002, z0]])
  // The vertical mark
  const hm = heightsAt(p, x0)
  if (hm && hm.up - hm.lo > 0.003) line([[x0, hm.lo + 0.001], [x0, hm.up - 0.001]])
  // Ticks every tenth of the core's chord, top and bottom, 2 mm in: the same tenths on both
  // templates, for calling out the wire's progress at each end
  for (let k = 1; k < 10; k++) {
    const x = p.x0 + ((p.x1 - p.x0) * k) / 10
    const h = heightsAt(p, x)
    if (!h || h.up - h.lo < 0.006) continue
    line([[x, h.up], [x, h.up - 0.002]])
    line([[x, h.lo], [x, h.lo + 0.002]])
  }
  // The spar caps' slots under each skin, and the web's slot between them
  const sp = structure.spar
  const [front, rear] = lineFaces(a.sparX, sparWidth(sp))
  const cf = front(s)
  const cr = rear(s)
  const hf = heightsAt(p, cf)
  const hr = heightsAt(p, cr)
  if (hf && hr) {
    const tc = sp.capThickness
    const top = Math.min(hf.up, hr.up)
    const bot = Math.max(hf.lo, hr.lo)
    line([[cf, hf.up], [cf, top - tc], [cr, top - tc], [cr, hr.up]])
    line([[cf, hf.lo], [cf, bot + tc], [cr, bot + tc], [cr, hr.lo]])
    if (sp.webThickness > 0 && top - bot > 2 * tc) {
      line([[cf, bot + tc], [cf, top - tc]])
      line([[cf + sp.webThickness, bot + tc], [cf + sp.webThickness, top - tc]])
    }
  }
  // Hinge lines that reach this end (extended along their straight line)
  const hinges = []
  for (const sf of surfaces) {
    const x = sf.hingeX(s)
    const h = heightsAt(p, x)
    if (!h || h.up - h.lo < 0.001) continue
    line([[x, h.lo], [x, h.up]])
    hinges.push(sf)
  }
  // Lead-in at the trailing edge, lead-out at the front, along the chord line of the profile
  const back = heightsAt(p, p.x1)
  const nose = heightsAt(p, p.x0)
  const g = kerf / 2
  const guide = [
    [[p.x1 + g + leadIn, (back.up + back.lo) / 2], [p.x1 + g, (back.up + back.lo) / 2]].map(tr),
    [[p.x0 - g, (nose.up + nose.lo) / 2], [p.x0 - g - leadIn, (nose.up + nose.lo) / 2]].map(tr),
  ]
  return { outline, etch, guide, hinges, front: p.x0 - x0, z0 }
}

// The hot-wire templates for every core: a pair per panel, named HW1-I (inner end) and HW1-O
// (outer end), root outward. opts: { kerf, leadIn } in metres.
export function hotWireTemplates(a, structure, { kerf = WIRE_KERF, leadIn = LEAD_IN } = {}) {
  const out = []
  const surfaces = (a.surfaces ?? []).filter((x) => x.ok)
  const breaks = dihedralBreaks(a)
  ;(a.cores ?? []).forEach((c, i) => {
    const pIn = coreProfile(a, structure, c.from)
    const pOut = coreProfile(a, structure, c.to)
    if (!pIn || !pOut) return
    const datum = pairDatum(pIn, pOut)
    const onCore = surfaces.filter((sf) => sf.s0 < c.to - 1e-6 && sf.s1 > c.from + 1e-6)
    const k = i + 1
    for (const [end, s, p] of [
      ['inner', c.from, pIn],
      ['outer', c.to, pOut],
    ]) {
      const t = template(a, structure, p, datum, { kerf, leadIn, s, surfaces: onCore })
      const name = `HW${k}-${end === 'inner' ? 'I' : 'O'}`
      const sec = a.section(s)
      const twist = sec?.twist ?? 0
      const brk = breaks.find((b) => Math.abs(b.s - s) < 1e-4)
      const notes = [
        `Hot-wire template, ${c.name}, ${end} end (${mmText(s - a.rootS, 0)} from the root): the core between the skins, from the back of the leading edge stock to the front of the trailing edge stock, ${mmText(kerf / 2, 2)} bigger all round for a ${mmText(kerf, 2)} wire kerf`,
        datum.common
          ? `Set both templates of the pair with the engraved level line the same height above the block's base and the vertical marks on one line square across the block: the core's front is ${mmText(-t.front)} ahead of the mark here`
          : `The two ends of ${c.name} hardly overlap along the chord, so each template's marks are its own: the outer end's core starts ${mmText(pOut.x0 - pIn.x0)} aft of the inner end's, and the level lines are the chord's mid-height at each mark`,
        `Twist ${twist.toFixed(1)}° here, built into the profile's angle. Ticks every tenth of the chord top and bottom, to call out the wire's progress at each end; the spar cap slots are engraved under each skin`,
        'One pair cuts both halves: turn the block over, and the templates with it, for the other side',
      ]
      if (brk) notes.push(`Dihedral joint here: sand the core's end ${brk.angle.toFixed(1)}° off square to meet the next panel`)
      for (const sf of t.hinges) notes.push(`${sf.label}: hinge line engraved${sf.s0 > s + 1e-6 || sf.s1 < s - 1e-6 ? ' (extended to this end)' : ''}. Skin the core whole, then saw the surface off along it`)
      out.push({
        id: name,
        name,
        group: 'templates',
        material: 'template-stock',
        thickness: TEMPLATE_THICKNESS,
        qty: 1,
        outline: t.outline,
        holes: [],
        etch: t.etch,
        guide: t.guide,
        label: null,
        core: c.name,
        end,
        s,
        notes,
      })
    }
  })
  return out
}

// Half the dihedral change at each break between panels (where the core's end is bevelled).
function dihedralBreaks(a) {
  const ends = a.sampler.ends
  const out = []
  for (let i = 0; i < ends.length - 1; i++) {
    const delta = (ends[i + 1].rad - ends[i].rad) / RAD
    if (Math.abs(delta) > 0.05) out.push({ s: ends[i].outer.s, angle: Math.abs(delta) / 2 })
  }
  const first = Math.abs(ends[0].rad / RAD)
  if (first > 0.05) {
    // The fuselage side (a flat centre section inboard), or a one-piece wing's centreline, where
    // the two halves meet at twice the angle
    if (a.sampler.half > 0) {
      if (a.rootS < a.sampler.half - 1e-9) out.push({ s: a.sampler.half, angle: first / 2 })
    } else if (a.rootS < 1e-9) out.push({ s: 0, angle: first })
  }
  return out
}
// Developed width of a skin at s: the surface's length from the back of the leading edge
// stock to the front of the trailing edge stock.
export function skinWidth(a, structure, s, surface) {
  const sec = a.section(s)
  if (!sec || !(sec.c > 1e-4)) return 0
  const q0 = Math.min(0.5, (structure.le.width || 0) / sec.c)
  const q1 = Math.max(0.5, 1 - (structure.te.width || 0) / sec.c)
  let len = 0
  let prev = null
  for (let i = 0; i <= 60; i++) {
    const q = q0 + ((q1 - q0) * i) / 60
    const f = sec.surf(q)
    const pt = [q * sec.c, surface === 'upper' ? f.upper : f.lower]
    if (prev) len += Math.hypot(pt[0] - prev[0], pt[1] - prev[1])
    prev = pt
  }
  return len
}

// The area of the core's section at s, m².
export const coreArea = (a, structure, s) => {
  const p = coreProfile(a, structure, s)
  return p ? Math.abs(polygonArea(p.outline)) : 0
}

// The volume of one half wing's cores, m³ (Simpson's rule along each core).
export function coreVolume(a, structure, n = 20) {
  let v = 0
  for (const c of a.cores ?? []) {
    const L = c.to - c.from
    for (let i = 0; i <= n; i++) {
      const w = i === 0 || i === n ? 1 : i % 2 ? 4 : 2
      v += (w * coreArea(a, structure, c.from + (L * i) / n) * L) / (3 * n)
    }
  }
  return v
}

// Everything else to cut for a foam wing: the templates, the skins, a shear web per core, the
// pockets' routing templates; cut list lines for the foam blocks and the skin sheets; and the
// core's and the skin glue's weight on one half wing. both: a pair is being made.
export function foamParts(a, structure, { both = true, kerf = WIRE_KERF, leadIn = LEAD_IN } = {}) {
  const f = structure.foam
  const sides = both ? 2 : 1
  const parts = [...hotWireTemplates(a, structure, { kerf, leadIn })]
  const cutList = []
  // Skins: a top and a bottom one per core, developed from the section, and the sheets they're
  // cut from (joined edge to edge across the width as needed)
  const sheet = skinSheet(f.skin)
  const skinMat = MATERIALS[f.skin.material]?.short ?? f.skin.material
  let k = 1
  let sheets = 0
  for (const c of a.cores ?? []) {
    const ss = Array.from({ length: 9 }, (_, i) => c.from + ((c.to - c.from) * i) / 8)
    for (const surface of ['upper', 'lower']) {
      const ws = ss.map((s) => ({ s, w: skinWidth(a, structure, s, surface) }))
      const outline = [...ws.map((w) => [w.s - c.from, 0]).reverse(), ...ws.map((w) => [w.s - c.from, w.w])]
      const b = bounds(outline)
      const across = Math.ceil(b.h / sheet.width - 1e-9)
      const along = Math.ceil(b.w / sheet.length - 1e-9)
      sheets += across * along * sides
      const name = `K${k++}`
      parts.push({
        id: name,
        name,
        group: 'skins',
        material: f.skin.material,
        thickness: f.skin.thickness,
        qty: sides,
        outline,
        holes: [],
        etch: [],
        label: null,
        notes: [
          `${surface === 'upper' ? 'Top' : 'Bottom'} skin, ${c.name}, developed from the section, the straight edge at the leading edge: approximate, cut oversize and trim`,
          `${across > 1 ? `${across} sheets joined edge to edge across the width` : 'One sheet wide'}${along > 1 ? `, ${along} lengths joined end to end` : ''} (${mmText(sheet.width, 0)} × ${mmText(sheet.length, 0)} sheets)`,
        ],
      })
    }
  }
  if (sheets) {
    cutList.push({
      item: `Skin sheets, ${skinMat}`,
      material: f.skin.material,
      size: [sheet.width, f.skin.thickness],
      length: sheet.length,
      qty: sheets,
      buy: true,
      note: 'Sheets to buy for the skins (parts K), each cut from whole sheets with no nesting; joins taped and glued edge to edge before skinning',
    })
  }
  // A shear web per core, through a slot cut in the core at the caps' front face
  const sp = structure.spar
  if (sp.webThickness > 0) {
    for (const c of a.cores ?? []) {
      const gap = (s) => {
        const sec = a.section(s)
        const q = Math.min(0.95, Math.max(0.02, (a.sparX(s) - sec.xl) / sec.c))
        const ss = sparSection(structure, sec.depth(q), s - a.rootS)
        return Math.max(0, ss.d - sp.capThickness)
      }
      const L = Math.hypot(c.to - c.from, a.sparX(c.to) - a.sparX(c.from))
      const name = `W${parts.filter((p) => p.group === 'webs').length + 1}`
      parts.push({
        id: name,
        name,
        group: 'webs',
        material: sp.webMaterial,
        thickness: sp.webThickness,
        qty: sides,
        outline: [
          [0, 0],
          [L, 0],
          [L, gap(c.to)],
          [0, gap(c.from)],
        ],
        holes: [],
        etch: [],
        label: null,
        notes: [`Shear web, ${c.name}: grain vertical, glued into a slot cut through the core along the caps' front face before skinning, between the caps`],
      })
    }
  }
  // Routing templates for the pockets: each servo bay's (routed from below, the hatch cut from
  // the bottom skin over it) and each air brake's box or frame
  const pocket = (name, label, len, wid, note) => {
    const m = POCKET_MARGIN
    parts.push({
      id: name,
      name,
      group: 'pockets',
      material: 'template-stock',
      thickness: TEMPLATE_THICKNESS,
      qty: 1,
      outline: [
        [0, 0],
        [len + 2 * m, 0],
        [len + 2 * m, wid + 2 * m],
        [0, wid + 2 * m],
      ],
      holes: [
        [
          [m, m],
          [m + len, m],
          [m + len, m + wid],
          [m, m + wid],
        ],
      ],
      etch: [],
      label: null,
      notes: [`${label}: routing template, the opening the pocket's true size (${mmText(len)} along the span by ${mmText(wid)} along the chord). Enlarge it by your guide bush's offset, or use a bearing-guided cutter`, note],
    })
  }
  for (const b of (a.bays ?? []).filter((x) => x.ok)) {
    pocket(`${b.name}-T`, b.label, b.hatch.s1 - b.hatch.s0, b.hatch.x1 - b.hatch.x0, `Rout ${mmText(b.need)} deep into the core from below before skinning; cut the hatch from the bottom skin over it afterwards, and run the lead to the root in a channel behind the spar`)
  }
  for (const r of (a.brakes ?? []).filter((x) => x.ok)) {
    const blade = r.type === 'blade'
    const x0 = blade ? r.bx[0] : r.x0 - 0.005
    const x1 = blade ? r.bx[1] : r.x1 + 0.005
    pocket(
      `${r.name}-T`,
      r.label,
      r.inner[1] - r.inner[0],
      x1 - x0,
      blade ? 'Cut right through the core, from skin to skin, and line it with the box walls (AB parts)' : 'Rout from above as deep as the frame and the folded plate need, before skinning; cut the opening in the top skin afterwards',
    )
  }
  // The foam blocks: each core's chord and depth across both ends, its length, a margin all round
  for (const c of a.cores ?? []) {
    const ps = [coreProfile(a, structure, c.from), coreProfile(a, structure, c.to)].filter(Boolean)
    if (!ps.length) continue
    const xs = ps.flatMap((p) => p.outline.map(([x]) => x))
    const hs = ps.flatMap((p) => p.outline.map(([, h]) => h))
    cutList.push({
      item: `Foam block, ${c.name}`,
      material: f.core,
      size: [Math.max(...xs) - Math.min(...xs) + 2 * BLOCK_MARGIN, Math.max(...hs) - Math.min(...hs) + 2 * BLOCK_MARGIN],
      length: c.to - c.from + 2 * BLOCK_MARGIN,
      qty: sides,
      block: true,
      note: 'Chord by depth, at least: big enough for both ends of the core, swept and twisted, with 10 mm all round',
    })
  }
  const core = coreVolume(a, structure) * (MATERIALS[f.core]?.density ?? 0)
  const skinArea = parts.filter((p) => p.group === 'skins').reduce((m, p) => m + Math.abs(polygonArea(p.outline)), 0)
  return { parts, cutList, core, glue: skinArea * (f.glue || 0) }
}
