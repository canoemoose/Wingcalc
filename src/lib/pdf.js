// A 1:1 printable PDF of a drawing (the parts laid out for cutting, or the plan), tiled
// across ordinary paper with a title block on every sheet, or on one sheet sized to fit.
//
// The drawing is the same entities the DXF export writes (polylines and text in millimetres,
// y up), so what prints is what cuts. Written directly, no library: PDF only needs lines,
// rectangles and text in the standard Helvetica font here. Content streams are deflated.
//
// Print at 100% ("actual size"): every sheet carries a 50 mm bar to check.

import { zlibSync, strToU8 } from 'fflate'
import { bounds } from './ribs.js'

const PT = 72 / 25.4 // points per millimetre

export const PAPERS = {
  a4: { label: 'A4', w: 210, h: 297 },
  a3: { label: 'A3', w: 297, h: 420 },
  letter: { label: 'Letter', w: 215.9, h: 279.4 },
  tabloid: { label: 'Tabloid', w: 279.4, h: 431.8 },
  fit: { label: 'One sheet, sized to the drawing', w: null, h: null },
}

const MARGIN = 10 // mm, unprinted edge allowed for
const OVERLAP = 10 // mm, shared by neighbouring sheets, for taping together
const BLOCK_H = 26 // mm, the title block band along the bottom
const TITLE_W = 120 // mm

// Text in PDF's WinAnsi encoding (covers °, ×, –, £ and accented letters); anything else
// becomes '?'. Brackets and backslashes are escaped.
const WIN = { '€': 128, '‚': 130, '„': 132, '…': 133, '‘': 145, '’': 146, '“': 147, '”': 148, '–': 150, '—': 151 }
function pdfText(text) {
  let out = ''
  for (const ch of String(text)) {
    let code = WIN[ch] ?? ch.charCodeAt(0)
    if (code > 255 || (code > 126 && code < 160 && !Object.values(WIN).includes(code))) code = 63
    const c = String.fromCharCode(code)
    out += c === '(' || c === ')' || c === '\\' ? `\\${c}` : c
  }
  return out
}
// Approximate Helvetica width (average glyph 0.52 em), for laying out the title block
const textW = (text, size) => String(text).length * size * 0.52

const n = (v) => (Math.abs(v) < 1e-6 ? '0' : v.toFixed(3).replace(/\.?0+$/, ''))

// Content stream for one page: a little drawing API in millimetres, emitting PDF operators.
function pageCanvas() {
  const ops = []
  const api = {
    ops,
    width(mm) {
      ops.push(`${n(mm * PT)} w`)
      return api
    },
    colour(r, g, b) {
      ops.push(`${n(r)} ${n(g)} ${n(b)} RG`)
      return api
    },
    fill(r, g, b) {
      ops.push(`${n(r)} ${n(g)} ${n(b)} rg`)
      return api
    },
    dash(on, off) {
      ops.push(on ? `[${n(on * PT)} ${n(off * PT)}] 0 d` : '[] 0 d')
      return api
    },
    poly(pts, closed = false) {
      if (pts.length < 2) return api
      ops.push(`${n(pts[0][0] * PT)} ${n(pts[0][1] * PT)} m`)
      for (const [x, y] of pts.slice(1)) ops.push(`${n(x * PT)} ${n(y * PT)} l`)
      ops.push(closed ? 's' : 'S')
      return api
    },
    rect(x, y, w, h, fill = false) {
      ops.push(`${n(x * PT)} ${n(y * PT)} ${n(w * PT)} ${n(h * PT)} re ${fill ? 'f' : 'S'}`)
      return api
    },
    text(x, y, size, s) {
      // size in points
      ops.push(`BT /F1 ${n(size)} Tf ${n(x * PT)} ${n(y * PT)} Td (${pdfText(s)}) Tj ET`)
      return api
    },
    save() {
      ops.push('q')
      return api
    },
    restore() {
      ops.push('Q')
      return api
    },
    clip(x, y, w, h) {
      ops.push(`${n(x * PT)} ${n(y * PT)} ${n(w * PT)} ${n(h * PT)} re W n`)
      return api
    },
    translate(dx, dy) {
      ops.push(`1 0 0 1 ${n(dx * PT)} ${n(dy * PT)} cm`)
      return api
    },
  }
  return api
}

const LAYER_STYLE = {
  cut: { colour: [0, 0, 0], width: 0.25 },
  etch: { colour: [0.1, 0.3, 0.75], width: 0.18 },
  guide: { colour: [0.45, 0.45, 0.45], width: 0.18 },
  OUTLINE: { colour: [0, 0, 0], width: 0.35 },
  STOCK: { colour: [0.2, 0.5, 0.2], width: 0.25 },
  SPAR: { colour: [0.75, 0.1, 0.1], width: 0.3 },
  RIBS: { colour: [0.1, 0.3, 0.75], width: 0.25 },
  TEXT: { colour: [0.35, 0.35, 0.35], width: 0.18 },
}

function drawEntities(c, ents) {
  for (const e of ents) {
    const st = LAYER_STYLE[e.layer] ?? LAYER_STYLE.guide
    c.colour(...st.colour).fill(...st.colour).width(st.width)
    if (e.type === 'text') c.text(e.x, e.y, e.h * PT, e.text)
    else c.poly(e.pts, e.closed)
  }
}

// How a drawing of w × h mm splits across sheets of a paper, in the orientation needing fewer.
export function tiling(w, h, paperKey) {
  const paper = PAPERS[paperKey] ?? PAPERS.a4
  if (!paper.w) {
    const pw = Math.max(w + 2 * MARGIN, TITLE_W + 2 * MARGIN)
    const ph = h + 2 * MARGIN + BLOCK_H
    return { pw, ph, cols: 1, rows: 1, aw: w, ah: h, step: [w, h] }
  }
  const options = [
    [paper.w, paper.h],
    [paper.h, paper.w],
  ].map(([pw, ph]) => {
    const aw = pw - 2 * MARGIN
    const ah = ph - 2 * MARGIN - BLOCK_H
    const sx = aw - OVERLAP
    const sy = ah - OVERLAP
    const cols = Math.max(1, Math.ceil((w - OVERLAP) / sx))
    const rows = Math.max(1, Math.ceil((h - OVERLAP) / sy))
    return { pw, ph, cols, rows, aw, ah, step: [sx, sy] }
  })
  return options.sort((p, q) => p.cols * p.rows - q.cols * q.rows || p.cols - q.cols)[0]
}

// Shorten text to fit across the title block at a size (points), with an ellipsis
function fit(text, size) {
  const room = ((TITLE_W - 5) * PT) / (size * 0.52)
  const t = String(text)
  return t.length <= room ? t : `${t.slice(0, Math.max(1, Math.floor(room) - 1))}…`
}

const sheetName = (col, row) => `${String.fromCharCode(65 + row)}${col + 1}`

// The PDF file for a drawing: entities in mm (y up). meta: { project, drawing, date }.
export function drawingPdf(ents, { paper = 'a4', project = 'Untitled', drawing = '', date = new Date(), compress = true } = {}) {
  const pts = ents.flatMap((e) => (e.type === 'text' ? [[e.x, e.y]] : e.pts))
  const b = pts.length ? bounds(pts) : { x0: 0, y0: 0, w: 1, h: 1, x1: 1, y1: 1 }
  const t = tiling(b.w, b.h, paper)
  const total = t.cols * t.rows
  const when = date.toISOString().slice(0, 10)
  const pages = []
  for (let row = 0; row < t.rows; row++) {
    for (let col = 0; col < t.cols; col++) {
      const c = pageCanvas()
      const ax = MARGIN
      const ay = MARGIN + BLOCK_H
      // The part of the drawing this sheet shows; rows run down from the top of the drawing
      const ox = b.x0 + col * t.step[0]
      const oy = b.y1 - row * t.step[1] - t.ah
      c.save().clip(ax, ay, t.aw, t.ah).translate(ax - ox, ay - oy)
      drawEntities(c, ents)
      c.restore()
      // Frame, and where the neighbouring sheets overlap this one (dashed)
      c.colour(0.6, 0.6, 0.6).width(0.15).dash(0, 0).rect(ax, ay, t.aw, t.ah)
      c.dash(2, 1.5)
      if (col < t.cols - 1) c.poly([[ax + t.aw - OVERLAP, ay], [ax + t.aw - OVERLAP, ay + t.ah]])
      if (row < t.rows - 1) c.poly([[ax, ay + OVERLAP], [ax + t.aw, ay + OVERLAP]])
      c.dash(0, 0)
      // Neighbours named on each edge, to tape them up in order
      c.fill(0.4, 0.4, 0.4)
      if (col > 0) c.text(ax + 1.5, ay + t.ah / 2, 7, `< ${sheetName(col - 1, row)}`)
      if (col < t.cols - 1) c.text(ax + t.aw - 1.5 - textW(`${sheetName(col + 1, row)} >`, 7) / PT, ay + t.ah / 2, 7, `${sheetName(col + 1, row)} >`)
      if (row > 0) c.text(ax + t.aw / 2, ay + t.ah - 3.5, 7, `^ ${sheetName(col, row - 1)}`)
      if (row < t.rows - 1) c.text(ax + t.aw / 2, ay + 1.5, 7, `v ${sheetName(col, row + 1)}`)
      // Title block, bottom right; 50 mm check bar, bottom left
      const tx = t.pw - MARGIN - TITLE_W
      const ty = MARGIN
      const th = BLOCK_H - 4
      c.colour(0, 0, 0).width(0.3).rect(tx, ty, TITLE_W, th)
      c.width(0.15).poly([[tx, ty + th * 0.55], [tx + TITLE_W, ty + th * 0.55]]).poly([[tx + TITLE_W * 0.62, ty], [tx + TITLE_W * 0.62, ty + th * 0.55]])
      c.fill(0, 0, 0).text(tx + 2.5, ty + th - 5.5, 10, fit(project, 10)).text(tx + 2.5, ty + th * 0.55 + 2, 7.5, fit(drawing, 7.5))
      c.text(tx + 2.5, ty + 7.5, 7.5, 'Scale 1:1 - print at 100% (actual size)').text(tx + 2.5, ty + 2.5, 7.5, `Wingcalc, ${when}`)
      c.text(tx + TITLE_W * 0.62 + 2.5, ty + 7.5, 7.5, `Sheet ${sheetName(col, row)}`)
      c.text(tx + TITLE_W * 0.62 + 2.5, ty + 2.5, 7.5, `${row * t.cols + col + 1} of ${total} (${t.cols} x ${t.rows})`)
      const bx = MARGIN
      const by = MARGIN + 6
      c.fill(0, 0, 0).rect(bx, by, 10, 2.5, true).rect(bx + 20, by, 10, 2.5, true).rect(bx + 40, by, 10, 2.5, true)
      c.colour(0, 0, 0).width(0.2).rect(bx, by, 50, 2.5)
      c.text(bx, by - 4.5, 7, '50 mm: measure to check the print scale')
      pages.push({ w: t.pw, h: t.ph, content: c.ops.join('\n') })
    }
  }
  return writePdf(pages, { compress, title: `${project} - ${drawing}` })
}

// Assemble the PDF file: catalog, page tree, one Helvetica font, pages and their contents.
function writePdf(pages, { compress, title }) {
  const objects = [] // strings or { dict, stream: Uint8Array }
  const add = (o) => objects.push(o) && objects.length
  const catalog = add(null)
  const tree = add(null)
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
  const info = add(`<< /Title (${pdfText(title)}) /Producer (Wingcalc) >>`)
  const kids = []
  for (const p of pages) {
    const raw = strToU8(p.content, true) // latin1: the text is already WinAnsi bytes
    const data = compress ? zlibSync(raw) : raw
    const contents = add({ dict: `<< /Length ${data.length}${compress ? ' /Filter /FlateDecode' : ''} >>`, stream: data })
    kids.push(
      add(`<< /Type /Page /Parent ${tree} 0 R /MediaBox [0 0 ${n(p.w * PT)} ${n(p.h * PT)}] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${contents} 0 R >>`),
    )
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${tree} 0 R >>`
  objects[tree - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`
  const chunks = []
  let length = 0
  const push = (u8) => {
    chunks.push(u8)
    length += u8.length
  }
  const str = (s) => push(strToU8(s, true))
  str('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')
  const offsets = []
  objects.forEach((o, i) => {
    offsets.push(length)
    if (typeof o === 'string') str(`${i + 1} 0 obj\n${o}\nendobj\n`)
    else {
      str(`${i + 1} 0 obj\n${o.dict}\nstream\n`)
      push(o.stream)
      str('\nendstream\nendobj\n')
    }
  })
  const xref = length
  str(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`)
  for (const off of offsets) str(`${String(off).padStart(10, '0')} 00000 n \n`)
  str(`trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
  const out = new Uint8Array(length)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.length
  }
  return out
}
