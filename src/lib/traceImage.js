// A picture to trace over in the section editor: the geometry of cropping and rotating it, and of placing it on
// the drawing's chord. Pure, no Vue or DOM.
//
// Three frames:
//   image    the picture's own pixels, x right and y down
//   rotated  the picture turned by `deg` (clockwise on screen) about its centre, in a box just big enough to hold
//            it, origin at that box's top-left corner. The crop is a rectangle here.
//   drawing  the section editor's units, x along the chord and y up

const RAD = Math.PI / 180

// The size of the box that holds a w × h picture turned by deg
export function rotatedBounds(w, h, deg) {
  const c = Math.abs(Math.cos(deg * RAD))
  const s = Math.abs(Math.sin(deg * RAD))
  return { w: w * c + h * s, h: w * s + h * c }
}

// A point in the picture's pixels to the rotated frame, and back
export function toRotated([x, y], w, h, deg) {
  const b = rotatedBounds(w, h, deg)
  const c = Math.cos(deg * RAD)
  const s = Math.sin(deg * RAD)
  const u = x - w / 2
  const v = y - h / 2
  return [b.w / 2 + u * c - v * s, b.h / 2 + u * s + v * c]
}
export function fromRotated([x, y], w, h, deg) {
  const b = rotatedBounds(w, h, deg)
  const c = Math.cos(deg * RAD)
  const s = Math.sin(deg * RAD)
  const u = x - b.w / 2
  const v = y - b.h / 2
  return [w / 2 + u * c + v * s, h / 2 - u * s + v * c]
}

// An angle in (-180, 180]
export function wrapDeg(a) {
  const r = ((((a + 180) % 360) + 360) % 360) - 180
  return r === -180 ? 180 : r
}

// The rotation (deg) that lays the line from le to te (picture pixels) level, pointing right
export function levelAngle(le, te) {
  return wrapDeg((-Math.atan2(te[1] - le[1], te[0] - le[0])) / RAD)
}

// The chord's tilt in the rotated frame (deg, clockwise on screen, 0 when level and pointing right)
export function chordTilt(le, te, w, h, deg) {
  const a = toRotated(le, w, h, deg)
  const b = toRotated(te, w, h, deg)
  return wrapDeg(Math.atan2(b[1] - a[1], b[0] - a[0]) / RAD)
}

// The quarter turn nearest deg, and what's left over: deg = quarter + fine, fine in [-45, 45]
export function splitAngle(deg) {
  const quarter = wrapDeg(90 * Math.round(deg / 90))
  return { quarter, fine: wrapDeg(deg - quarter) }
}

// A crop rectangle { x, y, w, h } kept inside a box W × H and no smaller than min on either side
export function clampCrop(r, W, H, min = 8) {
  const w = Math.min(W, Math.max(min, r.w))
  const h = Math.min(H, Math.max(min, r.h))
  return { x: Math.min(W - w, Math.max(0, r.x)), y: Math.min(H - h, Math.max(0, r.y)), w, h }
}

// Drags one edge or corner of a crop rectangle (handle: some of 'n', 's', 'e', 'w', e.g. 'nw') by (dx, dy), or moves
// the whole rectangle ('move'), kept inside W × H
export function dragCrop(r, handle, dx, dy, W, H, min = 8) {
  if (handle === 'move') return clampCrop({ ...r, x: r.x + dx, y: r.y + dy }, W, H, min)
  let x0 = r.x
  let y0 = r.y
  let x1 = r.x + r.w
  let y1 = r.y + r.h
  if (handle.includes('w')) x0 = Math.min(x1 - min, Math.max(0, x0 + dx))
  if (handle.includes('e')) x1 = Math.max(x0 + min, Math.min(W, x1 + dx))
  if (handle.includes('n')) y0 = Math.min(y1 - min, Math.max(0, y0 + dy))
  if (handle.includes('s')) y1 = Math.max(y0 + min, Math.min(H, y1 + dy))
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

// The scale the cropped picture is rendered at: its own pixels, unless its longest side is over max
export function outputScale(crop, max = 2400) {
  const longest = Math.max(crop.w, crop.h)
  return longest > max ? max / longest : 1
}

// Where the markers land in the rendered crop (its pixels), from the picture's pixels
export function markersOut(p, src, crop, scale) {
  const [x, y] = toRotated(p, src.w, src.h, src.deg)
  return [(x - crop.x) * scale, (y - crop.y) * scale]
}

// The drawing's chord frame: its leading edge, the unit vector towards the trailing-edge midpoint, and its length
// (as SectionEditor's frame()). Placement of a picture (its pixels, y down) on it, so that le lands on the leading
// edge and te on the trailing-edge midpoint:
//   drawing = at + k · rot(phi) · (px − le.x, −(py − le.y))
export function placeTrace(le, te, frame) {
  const vx = te[0] - le[0]
  const vy = -(te[1] - le[1])
  const len = Math.hypot(vx, vy)
  if (!(len > 0) || !(frame.L > 0)) return null
  return {
    at: { x: frame.le.x, y: frame.le.y },
    k: frame.L / len,
    phi: Math.atan2(frame.uy, frame.ux) - Math.atan2(vy, vx),
    le: [le[0], le[1]],
  }
}

// A picture's pixel in drawing units
export function traceToDrawing(place, [px, py]) {
  const u = px - place.le[0]
  const v = -(py - place.le[1])
  const c = Math.cos(place.phi)
  const s = Math.sin(place.phi)
  return { x: place.at.x + place.k * (c * u - s * v), y: place.at.y + place.k * (s * u + c * v) }
}

// The SVG matrix(a b c d e f) that draws the picture in the editor's view: screen x = ox + S·x, y = oy − S·ve·y
export function traceMatrix(place, { S, ox, oy, ve = 1 }) {
  const c = Math.cos(place.phi)
  const s = Math.sin(place.phi)
  const k = place.k
  const a = S * k * c
  const cc = S * k * s
  const b = -S * ve * k * s
  const d = S * ve * k * c
  const [lx, ly] = place.le
  return [a, b, cc, d, ox + S * place.at.x - a * lx - cc * ly, oy - S * ve * place.at.y - b * lx - d * ly]
}

// The placement after the section is normalised (sectionSpline normalise(): the old leading edge, and the chord and
// angle it returns), so the picture moves with the outline
export function renormalised(place, le, { chord, angle }) {
  const t = angle * RAD
  const c = Math.cos(t)
  const s = Math.sin(t)
  const x = place.at.x - le.x
  const y = place.at.y - le.y
  return { ...place, at: { x: (x * c + y * s) / chord, y: (-x * s + y * c) / chord }, k: place.k / chord, phi: place.phi - t }
}
