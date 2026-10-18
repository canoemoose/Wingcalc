// A flat drawing of a piece of the wing that isn't cut from sheet, for the Part card (pieces
// from wing3d.js wingPieces): a cap strip's side profile as it sits on its rib, a strip's cross-
// section at mid-span (spar cap, edge stock, stringer, hinge spar, tube), the end view of a foam
// core's block with the core's section at each end inside it, and a servo's side view as in its
// maker's drawing. In metres, u across and z up:
//   shapes   [{ pts, kind }]: 'cut' (the material, filled), 'section' (material cut through,
//            hatched), 'hole', 'line' or 'dash' (outlines)
//   label    a word to put on the drawing ('Section'), or none
//   dims     [{ from, to, side }]: a dimension between two points, drawn off the given side
//            ('below', 'left' or 'right'), labelled with its length
//   caption  what the drawing shows
//   extra    anything the drawing can't show, as text-free numbers: a block's length
// Returns null for a piece with nothing to draw flat.
import { coreProfile, BLOCK_MARGIN } from './foamParts.js'
import { servoFrame, servoParts } from './servos.js'
import { bounds } from './ribs.js'

const rect = (u0, z0, u1, z1) => [
  [u0, z0],
  [u1, z0],
  [u1, z1],
  [u0, z1],
]

export function pieceDrawing(a, structure, piece) {
  if (piece.capStrip) return capStripDrawing(piece.capStrip)
  if (piece.section?.outline?.length > 2) return sectionDrawing(piece.section)
  if (Number.isFinite(piece.coreAt)) return blockDrawing(a, structure, piece.coreAt)
  if (piece.servo) return servoSide(piece.servo)
  return null
}

// Along the rib, from where it starts to where it stops: its length and its depth
function capStripDrawing(c) {
  const b = bounds(c.outline)
  return {
    shapes: [{ pts: c.outline, kind: 'cut' }],
    dims: [{ from: [b.x0, b.y0], to: [b.x1, b.y0], side: 'below' }],
    caption: 'Side profile, as it sits on the rib (top or bottom edge)',
  }
}

// Looking along the strip, leading edge to the left: its width and depth
function sectionDrawing(sec) {
  const b = bounds(sec.outline)
  const shift = (pts) => pts.map(([u, z]) => [u - b.x0, z - b.y0])
  return {
    shapes: [{ pts: shift(sec.outline), kind: 'section' }, ...(sec.holes ?? []).map((h) => ({ pts: shift(h), kind: 'hole' }))],
    label: 'Section',
    dims: [
      { from: [0, 0], to: [b.w, 0], side: 'below' },
      { from: [0, 0], to: [0, b.h], side: 'left' },
    ],
    caption: 'Cross-section at mid-span, looking outboard, leading edge to the left',
  }
}

// The block a core is cut from (foamParts' blocks): the core's section at its inner end (solid)
// and outer end (dashed), the block round both with its margin
function blockDrawing(a, structure, s) {
  const c = (a.cores ?? []).find((k) => s >= k.from - 1e-9 && s <= k.to + 1e-9)
  if (!c) return null
  const ends = [coreProfile(a, structure, c.from), coreProfile(a, structure, c.to)]
  if (!ends[0] || !ends[1]) return null
  const pts = ends.flatMap((p) => p.outline)
  const b = bounds(pts)
  const m = BLOCK_MARGIN
  const shift = (list) => list.map(([u, z]) => [u - b.x0 + m, z - b.y0 + m])
  const W = b.w + 2 * m
  const H = b.h + 2 * m
  return {
    shapes: [
      { pts: rect(0, 0, W, H), kind: 'cut' },
      { pts: shift(ends[0].outline), kind: 'line' },
      { pts: shift(ends[1].outline), kind: 'dash' },
    ],
    dims: [
      { from: [0, 0], to: [W, 0], side: 'below' },
      { from: [0, 0], to: [0, H], side: 'left' },
    ],
    caption: `End view of the foam block for the ${c.name}, with the core's section at its inner end (solid) and outer end (dashed), ${Math.round(m * 1000)} mm of foam round them`,
    extra: { blockLength: c.to - c.from + 2 * m },
  }
}

// From the side, as in the maker's drawing: the case and its gear tower, the lugs at their
// height (a wing servo's standing pair and tab), the output boss to the horn seat and the lead
// where it leaves; dimensioned across the lugs, to the lugs and to the horn seat
export function servoSide(servo) {
  const f = servo.frame ?? servoFrame(servo)
  const shapes = servoParts(f).map((p) => {
    if (p.box) return { pts: rect(p.box[0][0], p.box[2][0], p.box[0][1], p.box[2][1]), kind: p.kind === 'servoLead' ? 'line' : 'cut' }
    const c = p.cylinder
    return { pts: rect(c.x - c.r, c.z[0], c.x + c.r, c.z[1]), kind: 'cut' }
  })
  const b = bounds(shapes.flatMap((s) => s.pts))
  const half = f.lugSpan / 2
  const lugAt = f.wingLugs ? f.height - f.wingLugs.length : f.lugHeight
  return {
    shapes,
    dims: [
      { from: [-half, b.y0], to: [half, b.y0], side: 'below' },
      { from: [-half, 0], to: [-half, lugAt], side: 'left' },
      { from: [b.x1, 0], to: [b.x1, Math.max(f.height, f.output.top)], side: 'right' },
    ],
    caption: [
      servo.estimated ? `Side view, the case from ${servo.maker}'s figures, the lugs and output at its class's proportions (no drawing published)` : servo.model ? `Side view, from ${servo.maker ?? 'the maker'}'s drawing` : "Side view, at the class's typical size",
      `across the lugs, base to the ${f.wingLugs ? 'upper lugs' : 'lugs'}, and base to the horn seat`,
    ].join(': '),
  }
}
