<script setup>
// The drawn-section editor: the outline through the user's points on a grid in true units (or 3x vertical), the
// camber line and thickness markers, a seed outline, a curvature comb and the inflection warnings. It also edits the
// points: select points and segments, drag them, nudge and delete them. The geometry is in src/lib/sectionSpline.js;
// this view draws it and turns pointer gestures into new point lists. Each finished gesture emits `commit` (one
// history step for the parent); the selection is emitted as `update:selection`.
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import StageZoom from './StageZoom.vue'
import {
  sampleSection, analyseSection, leIndex, curvature, naca4Points, SEEDS, yAt,
  applyRadius, bendSegment, moveStraightSegment, clampOrder, NOSE_MIN, NOSE_MAX,
  fairShape, isFairable, normalise, setStraight, mirrorSurface,
} from '../lib/sectionSpline.js'

const pts = defineModel('pts', { type: Array, required: true })
const props = defineProps({
  // The name of the seed the drawing started from (one of SEEDS), or null
  seed: { type: String, default: null },
  // The app's confirmation (ask() in WingCalc), resolving true to go ahead. Needed by the Reset actions.
  ask: { type: Function, default: null },
  // Index into analyseSection's infls of the curvature warning the side panel is pointing at, or -1
  highlight: { type: Number, default: -1 },
})
const emit = defineEmits(['commit', 'update:selection', 'update:seed', 'dragging'])

const showComb = ref(false)
const showCamber = ref(true)
const showSeed = ref(true)
const ve = ref(1)
// The command bar's "Keep max thickness" tick, and the popover open from the bar (reset, smooth or none)
const keepThick = ref(true)
const popOpen = ref('')

// Room kept clear of the corner controls: the view toggles along the top, the zoom buttons along the bottom
const TOP = 56
const BOTTOM = 50
// Fallback size, used until the stage can be measured (a hidden pane reports zero)
const W = ref(800)
const H = ref(500)
const S = ref(600)
const ox = ref(80)
const oy = ref(250)

// Hit radii on screen (px)
const TOL_PT = 8
const TOL_SEG = 6

const stageEl = ref(null)
const svgEl = ref(null)
let ro = null

// Selection: indices of points and of segments (segment i runs from point i to point i + 1)
const selPts = ref([])
const selSegs = ref([])
const boxRect = ref(null)
const panning = ref(false)
const notice = ref('')
// The gesture in progress (plain state, not rendered): kind is pt, seg, rad, box or pan
let gesture = null

const sx = (x) => ox.value + x * S.value
const sy = (y) => oy.value - y * S.value * ve.value
const dx = (px) => (px - ox.value) / S.value
const dy = (py) => (oy.value - py) / (S.value * ve.value)
const path = (Q, close) => 'M' + Q.map((p) => `${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join('L') + (close ? 'Z' : '')
const pc = (n, d = 1) => (n * 100).toFixed(d)
const sxy = (p) => ({ x: sx(p.x), y: sy(p.y) })
const clone = (P) => P.map((p) => ({ ...p }))
const freeIdx = (P) => {
  const l = leIndex(P)
  return P.map((_, i) => i).filter((i) => i !== l)
}

// Chord frame: the LE, the unit vector towards the TE midpoint, and the chord length
function frame(P) {
  const le = P[leIndex(P)], a = P[0], b = P[P.length - 1]
  const mx = (a.x + b.x) / 2 - le.x, my = (a.y + b.y) / 2 - le.y, L = Math.hypot(mx, my) || 1
  return { le, ux: mx / L, uy: my / L, L }
}

// Everything derived from the points, computed once per change
const geo = computed(() => {
  const P = pts.value
  if (!P || P.length < 5) return null
  const D = sampleSection(P)
  const A = analyseSection(P)
  const l = leIndex(P)
  // The normalised outline, for the camber line (same sample layout, so the LE index carries over)
  const nd = sampleSection(A.normalised.pts)
  return { P, D, A, l, nd, cf: frame(P) }
})

// The seed outline, when the drawing started from a named seed
const seedD = computed(() => {
  const s = SEEDS.find((e) => e.name === props.seed)
  return s ? sampleSection(naca4Points(s.code)) : null
})

// Fit the whole outline in the view, with the vertical scale in force
function fit() {
  const g = geo.value
  if (!g) return
  const ymax = Math.max(0.05, ...g.D.map((p) => Math.abs(p.y))) + 0.01
  const aw = W.value - 40
  const ah = H.value - TOP - BOTTOM
  S.value = Math.max(60, Math.min(aw / 1.12, ah / (2 * ymax * ve.value)))
  ox.value = (W.value - S.value) / 2
  oy.value = TOP + (H.value - TOP - BOTTOM) / 2
}

// Zoom about the point (px, py) on screen, which stays put
function zoomAt(px, py, f) {
  const x = dx(px)
  const y = dy(py)
  S.value = Math.max(40, Math.min(S.value * f, 20000))
  ox.value = px - x * S.value
  oy.value = py + y * S.value * ve.value
}

// Zoom about the centre of the view
function zoom(f) {
  zoomAt(W.value / 2, H.value / 2, f)
}

function measure() {
  const r = stageEl.value?.getBoundingClientRect()
  if (r && r.width > 0 && r.height > 0) {
    W.value = r.width
    H.value = r.height
  }
  fit()
}

watch(ve, () => fit())

// Keep the selection on points and segments that still exist (an undo or a redo can shorten the list)
watch(pts, (P) => {
  const ps = selPts.value.filter((i) => i < P.length)
  const ss = selSegs.value.filter((i) => i < P.length - 1)
  if (ps.length !== selPts.value.length || ss.length !== selSegs.value.length) setSelection(ps, ss)
})

function setSelection(points, segs) {
  selPts.value = [...new Set(points)].sort((a, b) => a - b)
  selSegs.value = [...new Set(segs)].sort((a, b) => a - b)
  emit('update:selection', { points: [...selPts.value], segments: [...selSegs.value] })
}

// Wheel zooms about the cursor. Registered directly so it can be non-passive (preventDefault).
function onWheel(e) {
  e.preventDefault()
  const p = local(e)
  zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0015))
}

onMounted(() => {
  measure()
  if (typeof ResizeObserver !== 'undefined' && stageEl.value) {
    ro = new ResizeObserver(measure)
    ro.observe(stageEl.value)
  }
  svgEl.value?.addEventListener('wheel', onWheel, { passive: false })
})
onBeforeUnmount(() => {
  ro?.disconnect()
  svgEl.value?.removeEventListener('wheel', onWheel)
})

/* ------------------------------ hit testing ------------------------------ */

// Distance from p to the segment a-b (all in screen px)
function distToSeg(p, a, b) {
  const vx = b.x - a.x, vy = b.y - a.y, L2 = vx * vx + vy * vy
  const t = L2 ? Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / L2)) : 0
  return Math.hypot(p.x - a.x - t * vx, p.y - a.y - t * vy)
}

// The point under p (within tol px), or -1
function hitPoint(p, tol = TOL_PT) {
  const g = geo.value
  if (!g) return -1
  let best = -1, bd = tol
  g.P.forEach((q, i) => {
    const d = Math.hypot(sx(q.x) - p.x, sy(q.y) - p.y)
    if (d < bd) { bd = d; best = i }
  })
  return best
}

// The segment nearest p (within tol px), or -1
function hitSeg(p, tol = TOL_SEG) {
  const g = geo.value
  if (!g) return -1
  let best = -1, bd = tol
  for (let i = 0; i < g.P.length - 1; i++) {
    const r = g.D.range[i]
    if (!r) continue
    for (let j = r[0]; j < r[1]; j++) {
      const d = distToSeg(p, sxy(g.D[j]), sxy(g.D[j + 1]))
      if (d < bd) { bd = d; best = i }
    }
  }
  return best
}

// The nose handle: on the chord line at 2r from the LE (the nose circle's diameter end)
function radHandle(g) {
  const m = 2 * (g.P[g.l].r || 0) * g.cf.L
  return { x: sx(g.cf.le.x + g.cf.ux * m), y: sy(g.cf.le.y + g.cf.uy * m) }
}
function hitRad(p) {
  const g = geo.value
  if (!g) return false
  const h = radHandle(g)
  return Math.hypot(h.x - p.x, h.y - p.y) < TOL_PT
}

// The sample of segment si nearest p, as an index into D
function nearestSample(D, si, p) {
  const r = D.range[si]
  let k = r[0], bd = Infinity
  for (let j = r[0]; j <= r[1]; j++) {
    const d = Math.hypot(sx(D[j].x) - p.x, sy(D[j].y) - p.y)
    if (d < bd) { bd = d; k = j }
  }
  return k
}

// Fraction along segment si of the sample nearest p
function fracOn(D, si, p) {
  const r = D.range[si]
  return (nearestSample(D, si, p) - r[0]) / ((r[1] - r[0]) || 1)
}

// Along or across a straight segment, whichever the drag is nearer, judged on screen
function segAxis(P, si, mx, my) {
  const a = sxy(P[si]), b = sxy(P[si + 1])
  const tx = b.x - a.x, ty = b.y - a.y, tl = Math.hypot(tx, ty) || 1
  const along = Math.abs(mx * tx + my * ty) / tl
  const across = Math.abs(-mx * ty + my * tx) / tl
  return along >= across ? 'along' : 'across'
}

/* ------------------------------ pointer ------------------------------ */

const local = (e) => {
  const r = svgEl.value.getBoundingClientRect()
  return { x: e.clientX - r.left, y: e.clientY - r.top }
}
function capture(e) {
  try { svgEl.value.setPointerCapture(e.pointerId) } catch (err) { /* synthetic or released pointer: carry on */ }
}

// No middle-click autoscroll
function onMouseDown(e) {
  if (e.button === 1) e.preventDefault()
}

function onDown(e) {
  stageEl.value?.focus({ preventScroll: true })
  popOpen.value = ''
  const p = local(e)
  // Right or middle button pans, wherever it starts. The left button never pans: on the background it draws a box.
  if (e.button === 1 || e.button === 2) {
    e.preventDefault()
    capture(e)
    gesture = { kind: 'pan', start: p, ox0: ox.value, oy0: oy.value, moved: false }
    return
  }
  if (e.button !== 0 || !geo.value) return
  const g = geo.value, P = g.P, l = g.l
  capture(e)
  notice.value = ''
  const add = e.shiftKey || e.ctrlKey || e.metaKey

  if (hitRad(p)) {
    gesture = { kind: 'rad', start: p, moved: false, cf: g.cf, base: clone(P) }
    return
  }

  const pi = hitPoint(p)
  if (pi >= 0) {
    // The LE can be selected on its own, but never joins a multi-selection or moves
    if (add) {
      if (pi !== l) setSelection(selPts.value.includes(pi) ? selPts.value.filter((j) => j !== pi) : [...selPts.value, pi], selSegs.value)
      return
    }
    const inGroup = selPts.value.includes(pi)
    if (!inGroup) setSelection([pi], [])
    if (pi === l) return
    const group = inGroup ? selPts.value.filter((j) => j !== l) : [pi]
    gesture = {
      kind: 'pt', i: pi, group, origs: group.map((j) => ({ x: P[j].x, y: P[j].y })), start: p, moved: false,
      axis: null, base: clone(P), wasGroup: inGroup && selPts.value.length > 1,
    }
    return
  }

  const si = hitSeg(p)
  if (si >= 0) {
    if (add) {
      setSelection(selPts.value, selSegs.value.includes(si) ? selSegs.value.filter((j) => j !== si) : [...selSegs.value, si])
      return
    }
    setSelection([], [si])
    gesture = {
      kind: 'seg', ui: si, start: p, moved: false, base: clone(P), axis: null,
      u: fracOn(g.D, si, p), straight: !!P[si].straight,
    }
    return
  }

  gesture = {
    kind: 'box', start: p, moved: false, add,
    base: add ? { pts: [...selPts.value], segs: [...selSegs.value] } : { pts: [], segs: [] },
  }
}

function onMove(e) {
  const g = gesture
  if (!g) return
  const p = local(e)
  const mx = p.x - g.start.x, my = p.y - g.start.y
  if (!g.moved && Math.hypot(mx, my) < 3) return
  if (!g.moved && editing(g)) emit('dragging', true)
  g.moved = true
  if (g.kind === 'pan') {
    ox.value = g.ox0 + mx
    oy.value = g.oy0 + my
    panning.value = true
    return
  }
  if (g.kind === 'box') {
    boxRect.value = { x: Math.min(g.start.x, p.x), y: Math.min(g.start.y, p.y), w: Math.abs(mx), h: Math.abs(my) }
    return
  }
  const shift = e.shiftKey
  if (!shift) g.axis = null

  if (g.kind === 'rad') {
    // Distance along the chord from the LE, halved: the handle sits at 2r
    const cf = g.cf
    const r = ((dx(p.x) - cf.le.x) * cf.ux + (dy(p.y) - cf.le.y) * cf.uy) / (2 * cf.L)
    pts.value = applyRadius(g.base, Math.min(NOSE_MAX, Math.max(NOSE_MIN, r)))
    return
  }

  if (g.kind === 'seg') {
    const v = { x: mx / S.value, y: -my / (S.value * ve.value) }
    if (g.straight) {
      if (shift && !g.axis && Math.hypot(mx, my) > 6) g.axis = segAxis(g.base, g.ui, mx, my)
      pts.value = moveStraightSegment(g.base, g.ui, v, shift ? g.axis : null)
    } else {
      pts.value = bendSegment(g.base, g.ui, g.u, v)
    }
    return
  }

  // A point, or the selected group of points
  let ddx = mx / S.value, ddy = -my / (S.value * ve.value)
  if (shift) {
    if (!g.axis && Math.hypot(mx, my) > 6) g.axis = Math.abs(mx) > Math.abs(my) ? 'x' : 'y'
    if (g.axis === 'x') ddy = 0
    if (g.axis === 'y') ddx = 0
  }
  const next = clone(g.base)
  g.group.forEach((j, k) => {
    next[j].x = g.origs[k].x + ddx
    next[j].y = g.origs[k].y + ddy
  })
  pts.value = clampOrder(next, g.group)
}

// A gesture that changes the outline (a point, a segment or the nose)
const editing = (g) => g.kind === 'pt' || g.kind === 'seg' || g.kind === 'rad'

function onUp() {
  const g = gesture
  gesture = null
  panning.value = false
  if (!g) return
  if (g.moved && editing(g)) emit('dragging', false)

  if (g.kind === 'box') {
    const r = boxRect.value
    boxRect.value = null
    if (g.moved && r) {
      const x0 = r.x, x1 = r.x + r.w, y0 = r.y, y1 = r.y + r.h
      const inside = (q) => sx(q.x) >= x0 && sx(q.x) <= x1 && sy(q.y) >= y0 && sy(q.y) <= y1
      const P = pts.value, l = leIndex(P), D = geo.value.D
      const ps = []
      P.forEach((q, i) => { if (i !== l && inside(q)) ps.push(i) })
      const ss = []
      for (let i = 0; i < P.length - 1; i++) {
        const rg = D.range[i]
        if (rg && inside(D[Math.floor((rg[0] + rg[1]) / 2)])) ss.push(i)
      }
      setSelection(g.add ? [...g.base.pts, ...ps] : ps, g.add ? [...g.base.segs, ...ss] : ss)
    } else if (!g.add) {
      // A plain click on the background clears the selection
      setSelection([], [])
    }
    return
  }

  if (!g.moved) {
    // A plain click on one point of a multi-selection narrows it to that point
    if (g.kind === 'pt' && g.wasGroup) setSelection([g.i], [])
    return
  }
  if (g.kind === 'pt') {
    const n = g.group.length
    emit('commit', `Moved ${n} point${n > 1 ? 's' : ''}`)
  } else if (g.kind === 'seg') {
    const nose = g.base[g.ui].le || g.base[g.ui + 1].le
    emit('commit', nose ? 'Moved the free end of the nose segment' : g.straight ? 'Moved the straight segment' : 'Bent the segment')
  } else if (g.kind === 'rad') {
    emit('commit', `Set the leading-edge radius to ${pc(pts.value[leIndex(pts.value)].r, 2)} %`)
  }
}

// Adds a point on sampled curve k of segment si, which the new point splits
function insertPoint(si, k) {
  const P = pts.value
  const q = { x: geo.value.D[k].x, y: geo.value.D[k].y }
  // The new point starts the second half, so it keeps the straightness of the segment it splits
  if (P[si].straight) q.straight = true
  const next = clone(P)
  next.splice(si + 1, 0, q)
  pts.value = next
  setSelection([si + 1], [])
  emit('commit', 'Added a point')
}

// Double-click on a curved or straight segment adds a point there, on the sampled curve
function onDbl(e) {
  const g = geo.value
  if (!g) return
  const p = local(e)
  if (hitRad(p) || hitPoint(p) >= 0) return
  const si = hitSeg(p, 12)
  if (si < 0) return
  const P = g.P
  if (P[si].le || P[si + 1].le) return
  const r = g.D.range[si]
  const k = nearestSample(g.D, si, p)
  if (k <= r[0] || k >= r[1]) return
  insertPoint(si, k)
}

// Frames the given points and the samples of the given segments in the view, with a margin
function frameBox(xs, ys) {
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys)
  const bw = Math.max(x1 - x0, 0.08), bh = Math.max(y1 - y0, 0.02)
  const availW = W.value - 80, availH = H.value - TOP - BOTTOM - 40
  // Never closer than four times the whole-section scale, so a single point does not fill the view
  const fitS = Math.min((W.value - 40) / 1.12, (H.value - TOP - BOTTOM) / (2 * 0.2 * ve.value))
  S.value = Math.max(40, Math.min(availW / bw, availH / (bh * ve.value), fitS * 4, 20000))
  ox.value = W.value / 2 - ((x0 + x1) / 2) * S.value
  oy.value = TOP + (H.value - TOP - BOTTOM) / 2 + ((y0 + y1) / 2) * S.value * ve.value
}

// Selects the given points and segments and frames them in the view (used by the side panel's warnings)
function focusOn({ points = [], segments = [] } = {}) {
  const g = geo.value
  if (!g) return
  setSelection(points, segments)
  const xs = [], ys = []
  points.forEach((i) => { if (g.P[i]) { xs.push(g.P[i].x); ys.push(g.P[i].y) } })
  segments.forEach((i) => {
    const r = g.D.range[i]
    if (r) for (let j = r[0]; j <= r[1]; j++) { xs.push(g.D[j].x); ys.push(g.D[j].y) }
  })
  if (xs.length) frameBox(xs, ys)
}

/* ------------------------------ keyboard ------------------------------ */

const NUDGE = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }
// A held arrow key moves the points on every press; the history step is taken when the key is released
let nudged = false

// Moves the selected free points by step (a fraction of the chord)
function nudge([ux, uy], step) {
  const g = geo.value
  if (!g) return
  const idx = selPts.value.filter((j) => j !== g.l && j < g.P.length)
  if (!idx.length) return
  const s = step * g.cf.L
  const next = clone(g.P)
  idx.forEach((j) => {
    next[j].x += ux * s
    next[j].y += uy * s
  })
  pts.value = clampOrder(next, idx)
  nudged = true
}

// Removes the selected free points, keeping at least three on each surface (the LE is never removed)
function deleteSelected() {
  const g = geo.value
  if (!g) return
  const P = g.P, l = g.l
  let up = l, lo = P.length - 1 - l, skipped = 0
  const drop = new Set()
  for (const j of [...selPts.value].sort((a, b) => a - b)) {
    if (j === l || j >= P.length) continue
    if (j < l) {
      if (up - 1 < 3) { skipped++; continue }
      up--
    } else {
      if (lo - 1 < 3) { skipped++; continue }
      lo--
    }
    drop.add(j)
  }
  if (!drop.size) {
    if (skipped) notice.value = 'Each surface keeps at least three points'
    return
  }
  pts.value = P.filter((_, j) => !drop.has(j))
  setSelection([], [])
  notice.value = skipped ? 'Kept at least three points on each surface' : ''
  emit('commit', `Deleted ${drop.size} point${drop.size > 1 ? 's' : ''}`)
}

// F fits, + and − zoom, arrows nudge, Delete removes and Ctrl+A selects, while the drawing has focus
function onKey(e) {
  if (e.altKey) return
  // Escape closes an open popover first; the workspace treats a handled Escape as done
  if (e.key === 'Escape' && popOpen.value) {
    popOpen.value = ''
    e.preventDefault()
    return
  }
  if (e.ctrlKey || e.metaKey) {
    if (e.key === 'a' || e.key === 'A') {
      e.preventDefault()
      if (geo.value) setSelection(freeIdx(geo.value.P), [])
    }
    return
  }
  if (NUDGE[e.key]) {
    nudge(NUDGE[e.key], e.shiftKey ? 0.005 : 0.001)
    e.preventDefault()
    return
  }
  if (e.key === 'Delete') {
    e.preventDefault()
    deleteSelected()
    return
  }
  if (e.key === 'f' || e.key === 'F') fit()
  else if (e.key === '+' || e.key === '=') zoom(1.25)
  else if (e.key === '-' || e.key === '−') zoom(1 / 1.25)
  else return
  e.preventDefault()
}

function onKeyUp(e) {
  if (!NUDGE[e.key] || !nudged) return
  nudged = false
  emit('commit', 'Nudged the points')
}

/* ------------------------------ command bar ------------------------------ */

const touchesNose = (P, i) => !!(P[i]?.le || P[i + 1]?.le)
// The selected free points (the LE never counts), and the surface they sit on
const freeSel = computed(() => {
  const g = geo.value
  return g ? selPts.value.filter((i) => i !== g.l && i < g.P.length) : []
})
const surfaceSel = computed(() => {
  const l = geo.value?.l
  const f = freeSel.value
  if (!f.length) return null
  const up = f.some((i) => i < l), lo = f.some((i) => i > l)
  return up && lo ? 'mixed' : up ? 'upper' : 'lower'
})
// Selected segments that can be bent or straightened (not the nose ones)
const segsFree = computed(() => {
  const P = pts.value
  return selSegs.value.filter((i) => i < P.length - 1 && !touchesNose(P, i))
})
const canSmoothSel = computed(() => !!geo.value && selPts.value.some((i) => isFairable(pts.value, i)))
const segLabel = computed(() => {
  const g = geo.value
  if (!g || selPts.value.length !== 1) return ''
  const i = selPts.value[0]
  if (i === g.l) return 'Leading edge'
  return i < g.l ? `Upper point ${i + 1}` : `Lower point ${i - g.l}`
})
function smoothIdx(idxs, what) {
  if (!idxs.some((i) => isFairable(pts.value, i))) {
    notice.value = 'Nothing to smooth: the leading edge, trailing edge and straight-segment ends stay where they are'
    return
  }
  pts.value = fairShape(pts.value, idxs, { keepThickness: keepThick.value })
  emit('commit', `Smoothed ${what}`)
}
function setStraightSel(on) {
  let Q = pts.value
  for (const i of segsFree.value) Q = setStraight(Q, i, on)
  pts.value = Q
  emit('commit', on ? 'Made the segment straight' : 'Made the segment curved')
}
// Adds a point at the middle of the single selected segment
function addPointOnSel() {
  const g = geo.value
  const si = selSegs.value[0]
  if (!g || selSegs.value.length !== 1 || touchesNose(g.P, si)) return
  const r = g.D.range[si]
  if (!r) return
  insertPoint(si, Math.floor((r[0] + r[1]) / 2))
}
function mirrorSel() {
  const i = freeSel.value[0]
  if (i == null || surfaceSel.value === 'mixed') return
  const from = surfaceSel.value
  pts.value = mirrorSurface(pts.value, i)
  setSelection([], [])
  emit('commit', `Mirrored the ${from} surface to the other side`)
}
function normaliseSection() {
  pts.value = normalise(pts.value).pts
  emit('commit', 'Normalised to a unit chord')
  fit()
}
// What the command bar offers depends on the selection: points win over segments
const barMode = computed(() => (selPts.value.length ? 'points' : selSegs.value.length ? 'segments' : 'none'))
const canAddPoint = computed(() => !!geo.value && selSegs.value.length === 1 && !touchesNose(pts.value, selSegs.value[0]))
// Notes under the seed names in the Reset popover
const seedNotes = {
  '2412': 'Cambered, 12 % thick. The classic trainer section.',
  '0012': 'Symmetric, 12 % thick. Aerobatic and tail surfaces.',
  '4415': 'High camber, 15 % thick. Slow, high-lift wings.',
}
const surfaceIdx = (w) => {
  const l = geo.value.l
  return pts.value.map((_, i) => i).filter((i) => w === 'both' || (w === 'upper' ? i < l : i > l))
}
// Reset actions: confirmed first, then one history step. The seed is part of the history, so undo brings it back.
const startPts = clone(pts.value)
const startSeed = props.seed
const unchangedFromStart = computed(() => JSON.stringify(pts.value) === JSON.stringify(startPts) && props.seed === startSeed)
async function confirmThen(request, apply) {
  popOpen.value = ''
  if (!props.ask || !(await props.ask({ ...request, danger: false }))) return
  apply()
  fit()
}
function resetToStart() {
  confirmThen({ title: 'Back to the start of this edit?', message: 'Every change since you opened the editor is replaced. Undo brings them back.', confirm: 'Reset' }, () => {
    pts.value = clone(startPts)
    emit('update:seed', startSeed)
    setSelection([], [])
    emit('commit', 'Reset to the start of this edit')
  })
}
function resetToSeed(sd) {
  confirmThen({ title: `Reset to ${sd.name}?`, message: 'The current shape is replaced with this section. Undo brings it back.', confirm: 'Reset' }, () => {
    pts.value = naca4Points(sd.code)
    emit('update:seed', sd.name)
    setSelection([], [])
    emit('commit', `Reset to ${sd.name}`)
  })
}

// Runs a side-panel action on the selection (the same actions as the bar)
function run(act) {
  if (act === 'smooth') smoothIdx(selPts.value, freeSel.value.length > 1 ? `${freeSel.value.length} points` : 'the point')
  else if (act === 'delete') deleteSelected()
  else if (act === 'mirror') mirrorSel()
}

// The SVG markup, rebuilt when the points, the view, the selection or a toggle changes
const body = computed(() => {
  const g = geo.value
  if (!g) return ''
  const { P, D, A, l, nd, cf } = g
  const Wv = W.value
  const Hv = H.value
  const v = ve.value
  let o = ''

  // Grid in true units: x major every 10 % chord, minor every 5 %; y minor 2.5 %, major 10 %. At 3x the y lines sit
  // 3x further apart, because they are true distances.
  const x0 = dx(0)
  const x1 = dx(Wv)
  const yTop = dy(Hv)
  const yBottom = dy(0)
  for (let k = Math.ceil(x0 / 0.05); k <= x1 / 0.05; k++) {
    const x = sx(k * 0.05).toFixed(1)
    o += `<line class="${k % 2 ? 'wc-sec__minor' : 'wc-sec__major'}" x1="${x}" x2="${x}" y1="0" y2="${Hv}"/>`
  }
  for (let k = Math.ceil(yTop / 0.025); k <= yBottom / 0.025; k++) {
    const y = sy(k * 0.025).toFixed(1)
    o += `<line class="${k % 4 ? 'wc-sec__minor' : 'wc-sec__major'}" x1="0" x2="${Wv}" y1="${y}" y2="${y}"/>`
  }

  // Rulers always read true % chord, whatever the exaggeration
  for (let k = Math.ceil(yTop / 0.05); k <= yBottom / 0.05; k++) {
    const y = k * 0.05
    const py = sy(y)
    if (py < 44 || py > Hv - 44) continue
    const sign = y < -1e-9 ? '−' : y > 1e-9 ? '+' : ''
    o += `<text class="wc-sec__ruler" x="5" y="${(py - 3).toFixed(1)}">${sign}${Math.abs(y * 100).toFixed(0)} %</text>`
  }
  for (let k = Math.ceil(x0 / 0.1); k <= x1 / 0.1; k++) {
    const px = sx(k * 0.1)
    if (px < 30 || px > Wv - 30) continue
    o += `<text class="wc-sec__ruler" x="${(px + 3).toFixed(1)}" y="${Hv - 32}">${(k * 10).toFixed(0)} %</text>`
  }
  o += `<text class="wc-sec__ruler" x="${Wv - 8}" y="${Hv - 44}" text-anchor="end">Vertical ${v}×${v > 1 ? ' (grid 2.5 % chord, rulers true)' : ''}</text>`

  // Chord line, LE to the TE midpoint
  const te = { x: (P[0].x + P[P.length - 1].x) / 2, y: (P[0].y + P[P.length - 1].y) / 2 }
  o += `<line class="wc-sec__chord" x1="${sx(cf.le.x)}" y1="${sy(cf.le.y)}" x2="${sx(te.x)}" y2="${sy(te.y)}"/>`

  if (showSeed.value && seedD.value) o += `<path class="wc-sec__seed" d="${path(seedD.value, true)}"/>`
  o += `<path class="wc-sec__fill" d="${path(D, true)}"/>`

  // Nose circle: a dashed reference only, not part of the outline. It is a circle in model space, so the vertical
  // exaggeration stretches it like everything else.
  const R = cf.L * (P[l].r || 0)
  const nc = { x: cf.le.x + cf.ux * R, y: cf.le.y + cf.uy * R }
  o += `<g transform="translate(${sx(nc.x).toFixed(2)},${sy(nc.y).toFixed(2)}) scale(1,${v})"><circle class="wc-sec__le" r="${(R * S.value).toFixed(2)}"/></g>`

  if (showCamber.value) {
    // Camber line, mapped back from the normalised frame
    const N = A.normalised
    const nli = nd.at[l]
    const up = nd.slice(0, nli + 1).reverse()
    const lo = nd.slice(nli)
    const ang = (N.angle * Math.PI) / 180
    const c = Math.cos(ang)
    const s = Math.sin(ang)
    const L = N.chord
    const back = (x, y) => ({ x: cf.le.x + (x * c - y * s) * L, y: cf.le.y + (x * s + y * c) * L })
    const cam = []
    for (let x = 0; x <= 1.0001; x += 0.01) {
      const xx = Math.min(x, 0.9995)
      const yu = yAt(up, xx)
      const yl = yAt(lo, xx)
      if (yu != null && yl != null) cam.push(back(x, (yu + yl) / 2))
    }
    if (cam.length > 1) o += `<path class="wc-sec__camber" d="${path(cam, false)}"/>`

    // Max thickness marker
    const yu = yAt(up, A.xt)
    const yl = yAt(lo, A.xt)
    if (yu != null && yl != null) {
      const a = back(A.xt, yu)
      const b = back(A.xt, yl)
      o += `<line class="wc-sec__mark-t" x1="${sx(a.x)}" y1="${sy(a.y)}" x2="${sx(b.x)}" y2="${sy(b.y)}"/>`
      o += `<text class="wc-sec__label wc-sec__label--t" x="${(sx(a.x) + 6).toFixed(1)}" y="${(sy(a.y) - 7).toFixed(1)}">t ${pc(A.tmax)} % at ${pc(A.xt, 0)} %</text>`
    }
    // Max camber marker
    const cp = back(A.xc, A.cmax)
    if (Math.abs(A.cmax) > 0.0005) {
      o += `<circle class="wc-sec__mark-c" cx="${sx(cp.x).toFixed(1)}" cy="${sy(cp.y).toFixed(1)}" r="4.5"/>`
      o += `<text class="wc-sec__label wc-sec__label--c" x="${(sx(cp.x) - 4).toFixed(1)}" y="${(sy(cp.y) + (A.cmax >= 0 ? 20 : -12)).toFixed(1)}" text-anchor="middle">camber ${pc(A.cmax)} % at ${pc(A.xc, 0)} %</text>`
    }
  }

  if (showComb.value) {
    // Curvature comb: a thin tooth per few samples along the outward normal, its length the local curvature (not
    // pressure), with an envelope through the tooth tips
    const sc = D.map((p) => ({ x: sx(p.x), y: sy(p.y) }))
    const env = []
    for (let i = 1; i < D.length - 1; i++) {
      const k = curvature(D[i - 1], D[i], D[i + 1])
      const tx = sc[i + 1].x - sc[i - 1].x
      const ty = sc[i + 1].y - sc[i - 1].y
      const tl = Math.hypot(tx, ty) || 1
      // On screen (y down) a counter-clockwise traverse has its outward normal at (-ty, tx)
      const nx = -ty / tl
      const ny = tx / tl
      const len = Math.sign(k) * Math.min(80, 26 * Math.asinh(Math.abs(k) / 3))
      const ex = sc[i].x + nx * len
      const ey = sc[i].y + ny * len
      env.push(`${ex.toFixed(1)},${ey.toFixed(1)}`)
      if (i % 3 === 0) o += `<line class="wc-sec__comb" x1="${sc[i].x.toFixed(1)}" y1="${sc[i].y.toFixed(1)}" x2="${ex.toFixed(1)}" y2="${ey.toFixed(1)}"/>`
    }
    o += `<polyline class="wc-sec__comb-env" points="${env.join(' ')}"/>`
  }

  // Inflections that warn (two or more on one surface): the segment holding each is tinted, and a ring marks the
  // inflection itself
  let rings = ''
  A.infls.forEach((e, k) => {
    if (!e.warn || !D.range[e.ui]) return
    const [a, b] = D.range[e.ui]
    const i0 = Math.min(Math.floor(e.idx), D.length - 2)
    const fr = e.idx - i0
    const px = sx(D[i0].x + (D[i0 + 1].x - D[i0].x) * fr)
    const py = sy(D[i0].y + (D[i0 + 1].y - D[i0].y) * fr)
    // The warning the side panel is hovering gets a larger ring
    const hi = k === props.highlight
    o += `<path class="wc-sec__infl-seg${hi ? ' wc-sec__infl-seg--hi' : ''}" d="${path(D.slice(a, b + 1), false)}"/>`
    rings += `<circle class="wc-sec__infl${hi ? ' wc-sec__infl--hi' : ''}" cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${hi ? 12 : 8}"/>`
  })

  o += `<path class="wc-sec__outline" d="${path(D, false)}"/>` + rings

  // Selected segments, drawn over the outline
  for (const i of selSegs.value) {
    const r = D.range[i]
    if (r) o += `<path class="wc-sec__seg--sel" d="${path(D.slice(r[0], r[1] + 1), false)}"/>`
  }

  // Straight segments get a tick across them at the middle
  D.segs.forEach((g) => {
    if (!g.straight) return
    const m = D[Math.floor((g.from + g.to) / 2)]
    const a = D[g.from]
    const b = D[g.to]
    const tx = sx(b.x) - sx(a.x)
    const ty = sy(b.y) - sy(a.y)
    const tl = Math.hypot(tx, ty) || 1
    const nx = (-ty / tl) * 5
    const ny = (tx / tl) * 5
    o += `<line class="wc-sec__straight" x1="${(sx(m.x) - nx).toFixed(1)}" y1="${(sy(m.y) - ny).toFixed(1)}" x2="${(sx(m.x) + nx).toFixed(1)}" y2="${(sy(m.y) + ny).toFixed(1)}"/>`
  })

  // The nose handle: a diamond on the chord line at 2r from the LE
  const h = radHandle(g)
  o += `<path class="wc-sec__rad" d="M${h.x.toFixed(1)},${(h.y - 6).toFixed(1)}L${(h.x + 6).toFixed(1)},${h.y.toFixed(1)}L${h.x.toFixed(1)},${(h.y + 6).toFixed(1)}L${(h.x - 6).toFixed(1)},${h.y.toFixed(1)}Z"/>`

  P.forEach((p, i) => {
    const cls = ['wc-sec__pt', selPts.value.includes(i) ? 'wc-sec__pt--sel' : '', i === l ? 'wc-sec__pt--le' : ''].filter(Boolean).join(' ')
    o += `<circle class="${cls}" cx="${sx(p.x).toFixed(1)}" cy="${sy(p.y).toFixed(1)}" r="4.5"/>`
  })
  return o
})
defineExpose({ focusOn, run })
</script>

<template>
  <div
    ref="stageEl"
    class="wc-sec"
    tabindex="0"
    role="group"
    aria-label="Section drawing"
    @keydown="onKey"
    @keyup="onKeyUp"
    @contextmenu.prevent
  >
    <svg
      ref="svgEl"
      class="wc-sec__svg"
      :class="{ 'wc-sec__svg--panning': panning }"
      :viewBox="`0 0 ${W} ${H}`"
      aria-hidden="true"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="onUp"
      @mousedown="onMouseDown"
      @dblclick="onDbl"
    >
      <g v-html="body" />
      <rect v-if="boxRect" class="wc-sec__box" :x="boxRect.x" :y="boxRect.y" :width="boxRect.w" :height="boxRect.h" />
    </svg>
    <div class="wc-stage__corner wc-stage__corner--tl" role="group" aria-label="Drawing views">
      <button type="button" class="wc-button wc-stage__btn wc-sec__view" :aria-pressed="String(showComb)" title="Curvature comb along the outline" @click="showComb = !showComb">Comb</button>
      <button type="button" class="wc-button wc-stage__btn wc-sec__view" :aria-pressed="String(showCamber)" title="Camber line and the thickness and camber markers" @click="showCamber = !showCamber">Camber and markers</button>
      <button type="button" class="wc-button wc-stage__btn wc-sec__view" :aria-pressed="String(showSeed)" :disabled="!seedD" :title="seedD ? 'The outline the drawing started from' : 'The drawing did not start from a named seed'" @click="showSeed = !showSeed">Seed outline</button>
      <button type="button" class="wc-button wc-stage__btn wc-sec__view" :aria-pressed="String(ve === 1)" title="True proportions" @click="ve = 1">1×</button>
      <button type="button" class="wc-button wc-stage__btn wc-sec__view" :aria-pressed="String(ve === 3)" title="Vertical stretched three times, to see small bumps" @click="ve = 3">3×</button>
    </div>
    <div v-if="geo" class="wc-cmd" role="toolbar" aria-label="Section actions">
      <template v-if="barMode === 'points'">
        <span class="wc-cmd__label">{{ selPts.length === 1 ? segLabel : `${selPts.length} points` }}</span>
        <button type="button" class="wc-cmd__btn" :disabled="!canSmoothSel" title="Fair the selected points together so the curvature varies smoothly. Press again for more." @click="run('smooth')">Smooth</button>
        <label class="wc-cmd__check" title="Fairing shrinks the section a little. Tick this to rescale the thickness afterwards so the maximum thickness stays what it was."><input v-model="keepThick" type="checkbox" />Keep max thickness</label>
        <span class="wc-cmd__sep"></span>
        <button type="button" class="wc-cmd__btn wc-cmd__btn--danger" :disabled="!freeSel.length" :title="freeSel.length ? 'Delete the selected points (Delete)' : 'The leading edge cannot be deleted'" @click="deleteSelected">Delete points</button>
        <button type="button" class="wc-cmd__btn" :disabled="!surfaceSel || surfaceSel === 'mixed'" :title="surfaceSel === 'mixed' ? 'Select points on one surface to mirror it' : 'Make the other surface a mirror image of this one about the chord'" @click="mirrorSel">Mirror to other surface</button>
      </template>
      <template v-else-if="barMode === 'segments'">
        <span class="wc-cmd__label">{{ selSegs.length === 1 ? 'Segment' : `${selSegs.length} segments` }}</span>
        <button type="button" class="wc-cmd__btn" :disabled="!segsFree.length" :title="segsFree.length ? 'Make the selected segments straight' : 'The nose end of the outline is set by the radius, so this segment cannot be straightened'" @click="setStraightSel(true)">Make straight</button>
        <button type="button" class="wc-cmd__btn" :disabled="!segsFree.length" :title="segsFree.length ? 'Make the selected segments curved again' : 'The nose end of the outline is set by the radius, so this segment cannot be curved'" @click="setStraightSel(false)">Make curved</button>
        <span class="wc-cmd__sep"></span>
        <button type="button" class="wc-cmd__btn" :disabled="!canAddPoint" :title="canAddPoint ? 'Add a point in the middle of this segment' : 'Select one segment that is not at the nose'" @click="addPointOnSel">Add point</button>
      </template>
      <template v-else>
        <span class="wc-cmd__label">Section</span>
        <button type="button" class="wc-cmd__btn" :aria-expanded="String(popOpen === 'reset' || popOpen === 'seeds')" title="Go back to the start of this edit, or to a built-in section. Undo brings the shape back." @click="popOpen = popOpen === 'reset' || popOpen === 'seeds' ? '' : 'reset'">Reset…</button>
        <span class="wc-cmd__sep"></span>
        <button type="button" class="wc-cmd__btn" title="Rotate and scale so the chord runs from the leading edge to the trailing-edge midpoint at unit length" @click="normaliseSection">Normalise</button>
        <span class="wc-cmd__sep"></span>
        <button type="button" class="wc-cmd__btn" title="Fair every free point on both surfaces so the curvature varies smoothly. Press again for more." @click="smoothIdx(pts.map((_, i) => i), 'the whole section')">Smooth all</button>
        <button type="button" class="wc-cmd__btn" :aria-expanded="String(popOpen === 'smooth')" title="Fair the upper surface, the lower surface or both" @click="popOpen = popOpen === 'smooth' ? '' : 'smooth'">Smooth surface…</button>
        <label class="wc-cmd__check" title="Fairing shrinks the section a little. Tick this to rescale the thickness afterwards so the maximum thickness stays what it was."><input v-model="keepThick" type="checkbox" />Keep max thickness</label>
      </template>
    </div>
    <div v-if="popOpen" class="wc-pop" role="dialog" :aria-label="popOpen === 'smooth' ? 'Smooth surface' : 'Reset'">
      <template v-if="popOpen === 'reset'">
        <p class="wc-pop__title">Reset</p>
        <div class="wc-pop__list">
          <button type="button" class="wc-button wc-pop__item" :disabled="unchangedFromStart" @click="resetToStart">Back to the start of this edit<small>{{ unchangedFromStart ? 'Nothing has changed since you opened the editor' : 'The shape as it was when you opened the editor' }}</small></button>
          <button type="button" class="wc-button wc-pop__item" @click="popOpen = 'seeds'">Back to a seed…<small>Replace the shape with a built-in section</small></button>
        </div>
      </template>
      <template v-else-if="popOpen === 'seeds'">
        <p class="wc-pop__title">Back to a seed</p>
        <div class="wc-pop__list">
          <button v-for="sd in SEEDS" :key="sd.code" type="button" class="wc-button wc-pop__item" @click="resetToSeed(sd)">{{ sd.name }}<small>{{ seedNotes[sd.code] }}</small></button>
        </div>
        <div class="wc-pop__row"><button type="button" class="wc-button" @click="popOpen = 'reset'">Back</button></div>
      </template>
      <template v-else>
        <p class="wc-pop__title">Smooth surface</p>
        <div class="wc-pop__list">
          <button type="button" class="wc-button wc-pop__item" @click="popOpen = ''; smoothIdx(surfaceIdx('both'), 'both surfaces')">Both surfaces<small>Fair every free point on the upper and lower surface</small></button>
          <button type="button" class="wc-button wc-pop__item" @click="popOpen = ''; smoothIdx(surfaceIdx('upper'), 'the upper surface')">Upper surface only<small>The lower surface stays as it is</small></button>
          <button type="button" class="wc-button wc-pop__item" @click="popOpen = ''; smoothIdx(surfaceIdx('lower'), 'the lower surface')">Lower surface only<small>The upper surface stays as it is</small></button>
        </div>
        <p class="wc-muted wc-pop__note">Each press fairs a little more. The leading edge, trailing edge and straight-segment ends do not move.</p>
      </template>
    </div>
    <p v-if="showComb" class="wc-sec__caption">
      Curvature comb: each tooth's length is the local curvature, drawn outward from the surface, so a tight bend has a long tooth.
      The envelope through the tooth tips should run smoothly; kinks and wobbles show where the curvature jumps.
    </p>
    <p v-if="notice" class="wc-sec__caption wc-sec__caption--notice">{{ notice }}</p>
    <StageZoom fit-title="Fit the drawing to the view (F)" @zoom-in="zoom(1.25)" @zoom-out="zoom(1 / 1.25)" @fit="fit" />
  </div>
</template>
