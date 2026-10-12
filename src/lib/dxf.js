// DXF export: the wing's parts laid out for cutting, and a full-size plan view to build on.
//
// Output is AutoCAD R12 ASCII DXF (AC1009) in millimetres, which nearly every laser,
// router and CAD program reads: closed POLYLINEs (or plain LINEs, for picky software) and
// optional TEXT. Labels are drawn as single-stroke vector lines by default so they etch the
// same everywhere.
//
// Machine compensation, applied to the cut geometry only:
//  - laser: each cut path moves half the kerf into the waste, so parts come out true size;
//  - router: dogbones in every internal corner of the cut (a round tool can't cut a square
//    inside corner, and the spar caps need one), and optionally the tool-radius offset if your
//    CAM doesn't apply it.

import { strokeText, textWidth } from './strokeFont.js'
import { MATERIALS } from './structure.js'
import { flatPanels } from './wing.js'
import { bounds, polygonArea } from './ribs.js'

export function defaultExportOptions() {
  return {
    parts: { ribs: true, gussets: true, braces: true, webs: true, sheeting: false, tip: true },
    machine: 'laser', // 'laser' | 'router'
    kerf: 0.00015, // m
    toolDiameter: 0.003175, // m
    dogbones: true,
    toolOffset: false,
    format: 'polyline', // 'polyline' | 'lines'
    layers: { cut: 'CUT', etch: 'ETCH', guide: 'GUIDE' },
    labels: true,
    labelStyle: 'strokes', // 'strokes' | 'text'
    handedness: 'pair', // 'right' | 'left' | 'pair'
    repeat: true, // lay out one copy of each part per piece needed
    rowLength: 0.9, // m: the usable length of a sheet
    gap: 0.003, // m between parts
    split: false, // one file per material and thickness, zipped
    pdfPaper: 'a4', // printed templates: a paper size from pdf.js PAPERS, or 'fit' for one sheet
  }
}

const MM = 1000
const GROUP_TITLES = { ribs: 'Ribs', gussets: 'Gussets', braces: 'Dihedral braces', webs: 'Shear webs', sheeting: 'Sheeting', tip: 'Tip block' }

// --- Contour operations -------------------------------------------------------------------------

const signedArea = polygonArea

// Offset a closed contour by d: positive grows it, negative shrinks it. Corners are mitred,
// with a bevel where the mitre would run out past four times the offset.
export function offsetContour(pts, d) {
  if (!d || pts.length < 3) return pts
  const ccw = signedArea(pts) > 0
  const n = pts.length
  const lines = []
  for (let i = 0; i < n; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % n]
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const len = Math.hypot(dx, dy)
    if (len < 1e-12) continue
    const nx = (ccw ? dy : -dy) / len
    const ny = (ccw ? -dx : dx) / len
    lines.push({ p: [a[0] + nx * d, a[1] + ny * d], dir: [dx / len, dy / len], len, v: a })
  }
  const out = []
  const m = lines.length
  for (let i = 0; i < m; i++) {
    const L0 = lines[(i - 1 + m) % m]
    const L1 = lines[i]
    const cross = L0.dir[0] * L1.dir[1] - L0.dir[1] * L1.dir[0]
    if (Math.abs(cross) < 1e-9) {
      out.push(L1.p)
      continue
    }
    // L0.p + t L0.dir = L1.p + u L1.dir
    const wx = L1.p[0] - L0.p[0]
    const wy = L1.p[1] - L0.p[1]
    const t = (wx * L1.dir[1] - wy * L1.dir[0]) / cross
    const q = [L0.p[0] + t * L0.dir[0], L0.p[1] + t * L0.dir[1]]
    if (Math.hypot(q[0] - L1.v[0], q[1] - L1.v[1]) > 4 * Math.abs(d)) {
      out.push([L0.p[0] + L0.dir[0] * L0.len, L0.p[1] + L0.dir[1] * L0.len], L1.p)
    } else out.push(q)
  }
  return out
}

// Dogbones: a round overcut of radius r into each sharp inside corner of the cut, so square
// parts fit. wasteInside: the contour is a hole (waste inside), else an outline. Corners
// whose edges are too short to take the dogbone are left and counted in `skipped`.
export function addDogbones(pts, r, wasteInside = false) {
  const n = pts.length
  if (n < 3 || !(r > 0)) return { pts, added: 0, skipped: 0 }
  const ccw = signedArea(pts) > 0
  const out = []
  let added = 0
  let skipped = 0
  for (let i = 0; i < n; i++) {
    const P = pts[(i - 1 + n) % n]
    const V = pts[i]
    const N = pts[(i + 1) % n]
    const la = Math.hypot(V[0] - P[0], V[1] - P[1])
    const lb = Math.hypot(N[0] - V[0], N[1] - V[1])
    if (la < 1e-12 || lb < 1e-12) {
      out.push(V)
      continue
    }
    const a = [(V[0] - P[0]) / la, (V[1] - P[1]) / la]
    const b = [(N[0] - V[0]) / lb, (N[1] - V[1]) / lb]
    const cross = a[0] * b[1] - a[1] * b[0]
    const convex = ccw ? cross > 0 : cross < 0
    const wasteCorner = wasteInside ? convex : !convex
    // The corner's angle on the waste side: only sharp ones (square-ish) need it
    const wasteAngle = Math.acos(Math.max(-1, Math.min(1, -(a[0] * b[0] + a[1] * b[1])))) // between -a and b
    if (!wasteCorner || wasteAngle > (150 * Math.PI) / 180 || Math.abs(cross) < 1e-6) {
      out.push(V)
      continue
    }
    const wx = b[0] - a[0]
    const wy = b[1] - a[1]
    const wl = Math.hypot(wx, wy)
    const w = [wx / wl, wy / wl]
    const tau = -2 * r * (a[0] * w[0] + a[1] * w[1])
    if (tau > 0.95 * la || tau > 0.95 * lb) {
      skipped++
      out.push(V)
      continue
    }
    const c = [V[0] + r * w[0], V[1] + r * w[1]]
    const P1 = [V[0] - tau * a[0], V[1] - tau * a[1]]
    const P2 = [V[0] + tau * b[0], V[1] + tau * b[1]]
    const ang = (p) => Math.atan2(p[1] - c[1], p[0] - c[0])
    const t1 = ang(P1)
    const tv = ang(V)
    const t2 = ang(P2)
    const ccwDelta = (from, to) => (((to - from) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
    const goCcw = ccwDelta(t1, tv) < ccwDelta(t1, t2)
    const sweep = goCcw ? ccwDelta(t1, t2) : -ccwDelta(t2, t1)
    out.push(P1)
    const steps = 10
    for (let k = 1; k < steps; k++) {
      const t = t1 + (sweep * k) / steps
      out.push([c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)])
    }
    out.push(P2)
    added++
  }
  return { pts: out, added, skipped }
}

// --- Parts to drawing entities ------------------------------------------------------------------

const toMm = (pts) => pts.map(([x, y]) => [x * MM, y * MM])
const rotate90 = (pts) => pts.map(([x, y]) => [-y, x])

function labelFor(part) {
  if (part.label?.text) return { ...part.label, u: part.label.u * MM, z: part.label.z * MM, h: part.label.h * MM }
  const b = bounds(toMm(part.outline))
  const h = Math.min(4, 0.3 * Math.min(b.w, b.h))
  if (h < 1.5) return null
  const w = textWidth(part.name, h)
  if (w > b.w * 0.9) return null
  return { text: part.name, u: b.x0 + (b.w - w) / 2, z: b.y0 + (b.h - h) / 2, h }
}

// One part as entities in its own millimetre coordinates (bounding box at the origin), with
// the machine compensation applied. Webs are turned so their grain runs along the sheet.
export function partEntities(part, opts) {
  const ents = []
  const notes = []
  let outline = toMm(part.outline)
  let holes = part.holes.map(toMm)
  let etch = part.etch.map(toMm)
  let label = opts.labels ? labelFor(part) : null
  if (part.group === 'webs') {
    outline = rotate90(outline)
    holes = holes.map(rotate90)
    etch = etch.map(rotate90)
    if (label) {
      const b = bounds(outline)
      const h = Math.min(4, 0.3 * Math.min(b.w, b.h))
      label = h >= 1.5 && textWidth(part.name, h) < b.w * 0.9 ? { text: part.name, u: b.x0 + 1, z: b.y0 + (b.h - h) / 2, h } : null
    }
  }
  // Dogbones and offsets on the cut only
  let cutOuter = outline
  let cutHoles = holes
  if (opts.machine === 'router' && opts.dogbones) {
    const r = (opts.toolDiameter * MM) / 2
    const o = addDogbones(cutOuter, r, false)
    cutOuter = o.pts
    let skipped = o.skipped
    cutHoles = cutHoles.map((h) => {
      const d = addDogbones(h, r, true)
      skipped += d.skipped
      return d.pts
    })
    if (skipped) notes.push(`${skipped} inside corner${skipped === 1 ? '' : 's'} too small for the tool`)
  }
  const comp = opts.machine === 'laser' ? (opts.kerf * MM) / 2 : opts.toolOffset ? (opts.toolDiameter * MM) / 2 : 0
  if (comp > 0) {
    cutOuter = offsetContour(cutOuter, comp)
    cutHoles = cutHoles.map((h) => offsetContour(h, -comp))
  }
  ents.push({ type: 'poly', layer: 'cut', pts: cutOuter, closed: true })
  for (const h of cutHoles) ents.push({ type: 'poly', layer: 'cut', pts: h, closed: true })
  for (const e of etch) ents.push({ type: 'poly', layer: 'etch', pts: e, closed: false })
  if (label) {
    if (opts.labelStyle === 'text') ents.push({ type: 'text', layer: 'etch', x: label.u, y: label.z, h: label.h, text: label.text })
    else for (const s of strokeText(label.text, label.u, label.z, label.h)) ents.push({ type: 'poly', layer: 'etch', pts: s, closed: false })
  }
  // Shift so the part's (uncompensated) bounding box starts at the origin
  const b = bounds([...outline, ...ents.filter((e) => e.type === 'poly' && e.layer === 'cut').flatMap((e) => e.pts)])
  return { ents: ents.map((e) => shiftEnt(e, -b.x0, -b.y0)), w: b.w, h: b.h, notes }
}

function shiftEnt(e, dx, dy) {
  if (e.type === 'text') return { ...e, x: e.x + dx, y: e.y + dy }
  return { ...e, pts: e.pts.map(([x, y]) => [x + dx, y + dy]) }
}

const fmtT = (t) => `${(t * MM).toFixed(1).replace(/\.0$/, '')} mm`
const materialLabel = (id) => MATERIALS[id]?.label ?? id

// Lay the parts out in rows, grouped by material and thickness (one sheet of stock each).
// Returns { groups: [{ key, title, material, thickness, entities, height, count }] } in mm.
export function layoutParts(parts, opts) {
  const chosen = parts.filter((p) => opts.parts[p.group] !== false)
  const byStock = new Map()
  for (const p of chosen) {
    const key = `${p.material}|${p.thickness.toFixed(5)}`
    if (!byStock.has(key)) byStock.set(key, [])
    byStock.get(key).push(p)
  }
  const gap = opts.gap * MM
  const rowLen = opts.rowLength * MM
  const groups = []
  const notes = []
  for (const [key, list] of byStock) {
    const ents = []
    const contents = [...new Set(list.map((p) => GROUP_TITLES[p.group] ?? p.group))]
    const title = `${contents.join(', ')}: ${fmtT(list[0].thickness)} ${materialLabel(list[0].material)}`
    let x = 0
    let y = 0 // top of the current row (rows go downward)
    let rowH = 0
    let count = 0
    for (const p of list) {
      const pe = partEntities(p, opts)
      for (const n of pe.notes) notes.push(`${p.name}: ${n}`)
      const copies = opts.repeat ? p.qty : 1
      for (let k = 0; k < copies; k++) {
        if (x > 0 && x + pe.w > rowLen) {
          x = 0
          y -= rowH + gap
          rowH = 0
        }
        for (const e of pe.ents) ents.push(shiftEnt(e, x, y - pe.h))
        x += pe.w + gap
        rowH = Math.max(rowH, pe.h)
        count++
      }
    }
    const height = -y + rowH
    groups.push({ key, title, material: list[0].material, thickness: list[0].thickness, entities: ents, height, count })
  }
  return { groups, notes }
}

// --- DXF text -------------------------------------------------------------------------------------

const LAYER_COLOURS = { cut: 1, etch: 5, guide: 8 } // red, blue, grey (ACI)
const num = (v) => (Math.abs(v) < 5e-5 ? '0' : v.toFixed(4).replace(/\.?0+$/, ''))
const clean = (s) => String(s).replace(/[^\x20-\x7e]/g, (c) => ({ '°': ' deg', '×': 'x', '–': '-', '—': '-' })[c] ?? '?')

// Write entities as an R12 DXF. layerNames maps the logical layers to the names wanted;
// format 'lines' writes every polyline as separate LINEs.
export function toDxf(entities, { layerNames = { cut: 'CUT', etch: 'ETCH', guide: 'GUIDE' }, format = 'polyline', extraLayers = {} } = {}) {
  const out = []
  const g = (code, value) => out.push(String(code), String(value))
  const names = { ...layerNames, ...Object.fromEntries(Object.keys(extraLayers).map((k) => [k, k])) }
  const colours = { ...LAYER_COLOURS, ...extraLayers }
  const used = [...new Set(entities.map((e) => e.layer))]
  g(0, 'SECTION')
  g(2, 'HEADER')
  g(9, '$ACADVER')
  g(1, 'AC1009')
  g(9, '$INSUNITS')
  g(70, 4)
  g(9, '$MEASUREMENT')
  g(70, 1)
  g(0, 'ENDSEC')
  g(0, 'SECTION')
  g(2, 'TABLES')
  g(0, 'TABLE')
  g(2, 'LTYPE')
  g(70, 1)
  g(0, 'LTYPE')
  g(2, 'CONTINUOUS')
  g(70, 0)
  g(3, 'Solid line')
  g(72, 65)
  g(73, 0)
  g(40, 0)
  g(0, 'ENDTAB')
  g(0, 'TABLE')
  g(2, 'LAYER')
  g(70, used.length)
  for (const l of used) {
    g(0, 'LAYER')
    g(2, clean(names[l] ?? l))
    g(70, 0)
    g(62, colours[l] ?? 7)
    g(6, 'CONTINUOUS')
  }
  g(0, 'ENDTAB')
  g(0, 'ENDSEC')
  g(0, 'SECTION')
  g(2, 'ENTITIES')
  for (const e of entities) {
    const layer = clean(names[e.layer] ?? e.layer)
    if (e.type === 'text') {
      g(0, 'TEXT')
      g(8, layer)
      g(10, num(e.x))
      g(20, num(e.y))
      g(30, 0)
      g(40, num(e.h))
      g(1, clean(e.text))
      continue
    }
    const pts = e.pts
    if (pts.length < 2) continue
    if (format === 'lines') {
      const m = e.closed ? pts.length : pts.length - 1
      for (let i = 0; i < m; i++) {
        const a = pts[i]
        const b = pts[(i + 1) % pts.length]
        g(0, 'LINE')
        g(8, layer)
        g(10, num(a[0]))
        g(20, num(a[1]))
        g(30, 0)
        g(11, num(b[0]))
        g(21, num(b[1]))
        g(31, 0)
      }
      continue
    }
    g(0, 'POLYLINE')
    g(8, layer)
    g(66, 1)
    g(10, 0)
    g(20, 0)
    g(30, 0)
    g(70, e.closed ? 1 : 0)
    for (const [x, y] of pts) {
      g(0, 'VERTEX')
      g(8, layer)
      g(10, num(x))
      g(20, num(y))
      g(30, 0)
    }
    g(0, 'SEQEND')
    g(8, layer)
  }
  g(0, 'ENDSEC')
  g(0, 'EOF')
  return out.join('\r\n') + '\r\n'
}

// The parts as one DXF (groups stacked down the page, each titled on the guide layer), or
// one per group. Returns [{ name, text, title }].
// A group of parts with its title above it, moved down the page by dy.
function titledGroup(grp, dy, opts) {
  const h = 5
  const head =
    opts.labelStyle === 'text'
      ? [{ type: 'text', layer: 'guide', x: 0, y: dy + 4, h, text: grp.title }]
      : strokeText(grp.title, 0, dy + 4, h).map((pts) => ({ type: 'poly', layer: 'guide', pts, closed: false }))
  return [...head, ...grp.entities.map((e) => shiftEnt(e, 0, dy))]
}

// Every group of parts stacked down one drawing, in mm: the parts DXF, and the printed PDF.
export function partsDrawing(parts, opts) {
  const { groups } = layoutParts(parts, opts)
  const ents = []
  let y = 0
  for (const grp of groups) {
    ents.push(...titledGroup(grp, y, opts))
    y -= grp.height + 25
  }
  return ents
}

export function partsDxf(parts, opts, baseName = 'wing') {
  const { groups } = layoutParts(parts, opts)
  const layerNames = opts.layers
  const file = (ents) => toDxf(ents, { layerNames, format: opts.format })
  const titled = (grp, dy) => titledGroup(grp, dy, opts)
  if (opts.split) {
    return groups.map((grp) => ({
      name: `${baseName}-${slug(grp.title)}.dxf`,
      title: grp.title,
      text: file(titled(grp, 0)),
    }))
  }
  return [{ name: `${baseName}-parts.dxf`, title: 'All parts', text: file(partsDrawing(parts, opts)) }]
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)

// --- Plan view --------------------------------------------------------------------------------------

// A full-size plan to build over: wing outline, LE and TE stock, spar, stringers and every rib
// at its thickness, with rib names. Right half by default; 'left' mirrors it, 'pair' draws
// both halves about the centreline. Plan layers are fixed: OUTLINE, STOCK, SPAR, RIBS, TEXT.
export function planEntities(a, structure, parts, { handedness = 'right' } = {}) {
  const raw = [] // in metres, (s, x)
  const add = (layer, pts, closed = false) => raw.push({ type: 'poly', layer, pts, closed })
  const flat = flatPanels(a.wing)
  // Outline, panel by panel, with the fuselage section (one-piece wings) and the tip
  const half = a.sampler.half
  if (half > 0 && a.rootS < half) {
    add('OUTLINE', [
      [0, 0],
      [half, 0],
      [half, a.wing.rootChord],
      [0, a.wing.rootChord],
    ], true)
  }
  for (const p of flat.panels) add('OUTLINE', p.polygon, true)
  if (flat.tip) add('OUTLINE', flat.tip.polygon, true)
  // Centreline
  const xs = flat.panels.flatMap((p) => p.polygon.map(([, x]) => x))
  const xMin = Math.min(0, ...xs)
  const xMax = Math.max(a.wing.rootChord, ...xs)
  add('OUTLINE', [
    [0, xMin - 0.02],
    [0, xMax + 0.02],
  ])
  // LE and TE stock inner edges, the spar's faces and stringers, sampled along the span
  const s0 = a.rootS
  const s1 = a.tipS
  const n = 80
  const line = (fn) => {
    const pts = []
    for (let i = 0; i <= n; i++) {
      const s = s0 + ((s1 - s0) * i) / n
      const v = fn(s)
      if (Number.isFinite(v)) pts.push([s, v])
    }
    return pts
  }
  const sec = (s) => a.section(s)
  add('STOCK', line((s) => sec(s).xl + structure.le.width))
  add('STOCK', line((s) => sec(s).xl + sec(s).c - structure.te.width))
  const sp = structure.spar
  const halfW = (sp.type === 'caps' || sp.type === 'box' ? sp.capWidth : sp.type === 'solid' ? sp.solidWidth : sp.tubeDiameter) / 2
  const sparEnd = sp.type === 'tube' && Number.isFinite(sp.tubeLength) ? Math.min(s1, s0 + sp.tubeLength) : s1
  const sparLine = (off) => line((s) => (s <= sparEnd + 1e-9 ? a.sparX(s) + off : NaN))
  add('SPAR', sparLine(-halfW))
  add('SPAR', sparLine(halfW))
  for (const st of structure.stringers ?? []) {
    if (Number.isFinite(st.position)) add('STOCK', line((s) => sec(s).xl + st.position * sec(s).c))
  }
  // Ribs, at their thickness, between the stock
  const t = structure.ribs.thickness
  const texts = []
  for (const p of parts.filter((q) => q.group === 'ribs')) {
    const r = p.rib
    const ang = (r.angle * Math.PI) / 180
    const d = [Math.sin(ang), Math.cos(ang)] // (ds, dx), aft
    const nrm = [d[1], -d[0]]
    const P = [p.s, a.sparX(p.s)]
    const at = (u, side) => [P[0] + d[0] * (u - r.sparU) + (nrm[0] * side * t) / 2, P[1] + d[1] * (u - r.sparU) + (nrm[1] * side * t) / 2]
    add('RIBS', [at(r.uA, -1), at(r.uB, -1), at(r.uB, 1), at(r.uA, 1)], true)
    const front = at(r.uA, 0)
    texts.push({ s: front[0], x: front[1] - structure.le.width - 0.008, text: p.name })
  }
  // To millimetres, drawing y up = leading edge at the top
  const sides = handedness === 'pair' ? [1, -1] : handedness === 'left' ? [-1] : [1]
  const ents = []
  for (const k of sides) {
    for (const e of raw) ents.push({ ...e, pts: e.pts.map(([s, x]) => [k * s * MM, -x * MM]) })
    for (const tx of texts) {
      const h = 4
      const w = textWidth(tx.text, h)
      for (const pts of strokeText(tx.text, k * tx.s * MM - w / 2, -tx.x * MM, h)) ents.push({ type: 'poly', layer: 'TEXT', pts, closed: false })
    }
  }
  return ents
}

export function planDxf(a, structure, parts, opts, baseName = 'wing') {
  const ents = planEntities(a, structure, parts, { handedness: opts.handedness })
  const extraLayers = { OUTLINE: 7, STOCK: 3, SPAR: 1, RIBS: 5, TEXT: 8 }
  return { name: `${baseName}-plan.dxf`, title: 'Plan', text: toDxf(ents, { extraLayers, format: opts.format }) }
}

// --- Cut list ---------------------------------------------------------------------------------------

const mm = (v) => (v * MM).toFixed(1).replace(/\.0$/, '')

// A CSV cut list: every sheet part (with quantity and stock) and every length of strip.
export function cutListCsv(parts, cutList) {
  const rows = [['Item', 'Quantity', 'Material', 'Size (mm)', 'Length (mm)', 'Notes']]
  for (const p of parts) {
    const b = bounds(p.outline)
    rows.push([p.name, p.qty, materialLabel(p.material), `${mm(p.thickness)} thick, ${mm(b.w)} x ${mm(b.h)}`, '', p.notes.join('; ')])
  }
  for (const c of cutList) {
    rows.push([c.item, c.qty, materialLabel(c.material), c.tube ? `${mm(c.size[0])} OD, ${mm(c.size[1])} wall` : `${mm(c.size[0])} x ${mm(c.size[1])}`, mm(c.length), [c.triangular && 'Triangular section', c.note].filter(Boolean).join('; ')])
  }
  const cell = (v) => {
    const s = String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n'
}

// --- Reading DXF back (for tests and checks) ----------------------------------------------------------

export function parseDxf(text) {
  const lines = text.split(/\r?\n/)
  const pairs = []
  for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([Number(lines[i].trim()), lines[i + 1].trim()])
  const out = { polylines: [], lines: [], texts: [], layers: [], version: null }
  let i = 0
  const read = () => {
    // Read one entity's group codes until the next 0
    const e = {}
    while (i < pairs.length && pairs[i][0] !== 0) {
      const [c, v] = pairs[i]
      ;(e[c] ??= []).push(v)
      i++
    }
    return e
  }
  while (i < pairs.length) {
    const [code, value] = pairs[i]
    i++
    if (code === 9 && value === '$ACADVER') out.version = pairs[i]?.[1]
    if (code !== 0) continue
    if (value === 'LAYER') {
      const e = read()
      if (e[2]) out.layers.push(e[2][0])
    } else if (value === 'POLYLINE') {
      const e = read()
      const pl = { layer: e[8]?.[0], closed: (Number(e[70]?.[0]) & 1) === 1, pts: [] }
      while (i < pairs.length && pairs[i][1] === 'VERTEX') {
        i++
        const v = read()
        pl.pts.push([Number(v[10][0]), Number(v[20][0])])
      }
      if (pairs[i]?.[1] === 'SEQEND') {
        i++
        read()
      }
      out.polylines.push(pl)
    } else if (value === 'LINE') {
      const e = read()
      out.lines.push({ layer: e[8]?.[0], a: [Number(e[10][0]), Number(e[20][0])], b: [Number(e[11][0]), Number(e[21][0])] })
    } else if (value === 'TEXT') {
      const e = read()
      out.texts.push({ layer: e[8]?.[0], x: Number(e[10][0]), y: Number(e[20][0]), h: Number(e[40][0]), text: e[1]?.[0] })
    }
  }
  return out
}
