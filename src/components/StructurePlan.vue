<script setup>
// The half wing seen from above, flat as built, with its structure: leading and trailing
// edge stock, the spar, stringers, every rib, and the control surfaces' hinge spars and ribs. Bays where a margin falls below zero are
// shaded. Click a rib to select it.
//
// It navigates like the wing plan editor: scroll to zoom about the pointer, drag empty space
// to pan, − + Fit in the bottom-right corner (F, + and −), with a grid that adapts to the
// zoom. With manual rib spacing it edits too, without modes: drag a rib along the span (it
// snaps to the grid, measured from the root rib; Alt places freely), double-click the wing to
// add one there, or Add rib in the command bar (or A) to add one mid-way along the longest
// bay. Delete (or the command bar) removes the selected rib, and the arrow keys nudge it a
// grid step (Shift for ten). Manual ribs and hard points move; root, panel-break and tip
// ribs are fixed.
//
// Layers (top left), as in the 3D view: each kind of part can be hidden, and only those the wing
// has are listed. The menu closes on Esc, its button, or a press outside it.
import { computed, ref, reactive, watch, onMounted, onBeforeUnmount, useId } from 'vue'
import { EYE, EYE_OFF } from '../lib/icons.js'
import { flatPanels } from '../lib/wing.js'
import { MODES, SPACING_MODES, sheetOutline, hardPatches, patchSpan } from '../lib/structure.js'
import { format, defaultUnit, systemOf } from '../lib/units.js'
import StageZoom from './StageZoom.vue'

const props = defineProps({
  analysis: { type: Object, required: true },
  parts: { type: Array, required: true },
  selected: { type: String, default: null },
  system: { type: [String, Object], default: 'metric' }, // a units setting (units.js normaliseUnits) or system name
  // Manual spacing: ribs can be moved, added and removed here
  editable: { type: Boolean, default: false },
})
const emit = defineEmits(['select', 'commit'])
const structure = defineModel('structure', { type: Object, required: true })

const a = computed(() => props.analysis)
const flat = computed(() => flatPanels(a.value.wing))
const ribs = computed(() => props.parts.filter((p) => p.group === 'ribs'))
// The control surfaces' own ribs, behind their hinges
const surfaceRibs = computed(() => props.parts.filter((p) => p.group === 'surfaces'))
const lengthUnit = computed(() => defaultUnit(props.system, 'length'))
const fmt = (v) => format(v, 'length', lengthUnit.value)

const geom = computed(() => {
  const an = a.value
  const st = an.structure
  const s0 = an.rootS
  const s1 = an.tipS
  const n = 80
  const line = (fn) => {
    const pts = []
    for (let i = 0; i <= n; i++) {
      const s = s0 + ((s1 - s0) * i) / n
      const v = fn(s)
      if (Number.isFinite(v)) pts.push(`${s.toFixed(5)},${v.toFixed(5)}`)
    }
    return pts.join(' ')
  }
  const sec = (s) => an.section(s)
  const sp = st.spar
  const halfW = (sp.type === 'caps' || sp.type === 'box' ? sp.capWidth : sp.type === 'solid' ? sp.solidWidth : sp.tubeDiameter) / 2
  const sparEnd = sp.type === 'tube' && Number.isFinite(sp.tubeLength) ? Math.min(s1, s0 + sp.tubeLength) : s1
  const band = []
  for (let i = 0; i <= n; i++) {
    const s = s0 + ((sparEnd - s0) * i) / n
    band.push([s, an.sparX(s) - halfW])
  }
  for (let i = n; i >= 0; i--) {
    const s = s0 + ((sparEnd - s0) * i) / n
    band.push([s, an.sparX(s) + halfW])
  }
  // D-box or sheeting area, hatched
  const outline = sheetOutline(an, st, n)
  const sheet = outline && outline.map(([x, y]) => `${x.toFixed(5)},${y.toFixed(5)}`).join(' ')
  // Sheeted hard points, hatched like the sheeting
  const patches = hardPatches(st, an.rootS).map((h) => {
    const ss = Array.from({ length: 9 }, (_, i) => h.s0 + ((h.s1 - h.s0) * i) / 8)
    const at = (s, k) => patchSpan(an, st, s)?.[k] ?? an.section(s).xl
    return [...ss.map((s) => [s, at(s, 0)]), ...[...ss].reverse().map((s) => [s, at(s, 1)])].map(([x, y]) => `${x.toFixed(5)},${y.toFixed(5)}`).join(' ')
  })
  // Control surfaces: each hinge spar as a band, and the moving surface's outline
  const hinges = []
  for (const sf of (an.surfaces ?? []).filter((x) => x.ok)) {
    const band = (from, to, x0, x1) => {
      const ss = Array.from({ length: 9 }, (_, i) => from + ((to - from) * i) / 8)
      return [...ss.map((s) => [s, x0(s)]), ...[...ss].reverse().map((s) => [s, x1(s)])].map(([x, y]) => `${x.toFixed(5)},${y.toFixed(5)}`).join(' ')
    }
    const f = sf.faces
    const te = (s) => sec(s).xl + sec(s).c
    hinges.push({
      id: sf.id,
      label: sf.label,
      fixed: band(sf.fixed[0], sf.fixed[1], f.fixedFront, f.fixedRear),
      moving: band(sf.moving[0], sf.moving[1], f.apex, f.movingRear),
      outline: band(sf.moving[0], sf.moving[1], f.apex, te),
      // The Mylar tabs, each a rectangle centred on the hinge line
      tabs: (sf.tabs ?? []).map((s) => {
        const x = sf.hingeX(s), hw = st.hinges.tabWidth / 2, hl = st.hinges.tabLength / 2
        return [[s - hw, x - hl], [s + hw, x - hl], [s + hw, x + hl], [s - hw, x + hl]].map(([p, q]) => `${p.toFixed(5)},${q.toFixed(5)}`).join(' ')
      }),
    })
  }
  // Servo bays: the hatch opening, the servo's case, and its lead's route in to the root
  const pts = (list) => list.map(([x, y]) => `${x.toFixed(5)},${y.toFixed(5)}`).join(' ')
  const servos = (an.bays ?? [])
    .filter((b) => b.ok)
    .map((b) => {
      const box = (x0, x1, s0, s1) => pts([[s0, x0], [s1, x0], [s1, x1], [s0, x1]])
      const lead = Array.from({ length: 13 }, (_, i) => {
        const s = s0 + ((b.sA - s0) * i) / 12
        return [s, an.sparX(s) + halfW + b.lead.offset + b.lead.diameter / 2]
      })
      return {
        id: b.id,
        label: b.label,
        hatch: box(b.hatch.x0, b.hatch.x1, b.hatch.s0, b.hatch.s1),
        body: box(b.case.x0, b.case.x1, b.s - (b.servo.caseWidth ?? b.servo.width) / 2, b.s + (b.servo.caseWidth ?? b.servo.width) / 2),
        lead: pts(lead),
      }
    })
  // Air brakes: the box (blades) or frame (spoiler), the slots or opening in the covering, and
  // a spoiler's hinge line
  const brakes = (an.brakes ?? [])
    .filter((r) => r.ok)
    .map((r) => {
      const box = (x0, x1, s0, s1) => pts([[s0, x0], [s1, x0], [s1, x1], [s0, x1]])
      const pad = r.type === 'blade' ? r.bx : [r.x0 - 0.005, r.x1 + 0.005]
      return {
        id: r.id,
        label: r.label,
        type: r.type,
        box: box(pad[0], pad[1], r.inner[0], r.inner[1]),
        openings: r.openings.map((o) => box(o.x0, o.x1, o.s0, o.s1)),
        hinge: r.type === 'spoiler' ? pts([[r.s - r.length / 2, r.x0], [r.s + r.length / 2, r.x0]]) : null,
      }
    })
  return {
    hinges,
    servos,
    brakes,
    le: line((s) => sec(s).xl + st.le.width),
    te: line((s) => sec(s).xl + sec(s).c - st.te.width),
    spar: band.map(([x, y]) => `${x.toFixed(5)},${y.toFixed(5)}`).join(' '),
    stringers: (st.stringers ?? []).filter((x) => Number.isFinite(x.position)).map((x) => line((s) => sec(s).xl + x.position * sec(s).c)),
    sheet,
    patches,
  }
})

// Ribs that can be moved here: manual ribs and hard points, in manual mode
const movable = (p) => props.editable && (p.kind === 'manual' || p.kind === 'hard') && p.sourceId != null

// Each rib as a line in plan, from the LE stock to the TE stock
const ribLines = computed(() =>
  [...ribs.value, ...surfaceRibs.value].map((p) => {
    const r = p.rib
    const ang = (r.angle * Math.PI) / 180
    const d = [Math.sin(ang), Math.cos(ang)]
    const P = [p.s, a.value.sparX(p.s)]
    const at = (u) => [P[0] + d[0] * (u - r.sparU), P[1] + d[1] * (u - r.sparU)]
    const [x1, y1] = at(r.uA)
    const [x2, y2] = at(r.uB)
    return { id: p.id, name: p.name, kind: p.kind, x1, y1, x2, y2, movable: movable(p), surface: p.group === 'surfaces' }
  }),
)

// Bays with a negative margin anywhere in them: 'strength' if the section itself is short
// (closer ribs won't help), else 'spacing' if only the ribs are too far apart
const weak = computed(() => {
  const list = ribs.value
  const out = []
  for (let i = 1; i < list.length; i++) {
    const s0 = list[i - 1].s
    const s1 = list[i].s
    const modes = new Set()
    for (const r of a.value.stations) {
      if (r.s < s0 - 1e-9 || r.s > s1 + 1e-9) continue
      for (const [k, m] of Object.entries(r.ms)) if (Number.isFinite(m) && m < 0) modes.add(k)
    }
    if (!modes.size) continue
    const kind = [...modes].some((k) => !SPACING_MODES.includes(k)) ? 'strength' : 'spacing'
    out.push({ s0, s1, kind, title: [...modes].map((k) => MODES[k] ?? k).join(', ') })
  }
  return out
})
const weakKinds = computed(() => new Set(weak.value.map((b) => b.kind)))

// --- View: fit, zoom and pan ---------------------------------------------------------------

// The fitted frame; the element keeps its proportions, and zooming scales the view box in them
const fit = computed(() => {
  const pts = [...flat.value.panels.flatMap((p) => p.polygon), ...(flat.value.tip?.polygon ?? [])]
  const xs = pts.map(([s]) => s)
  const ys = pts.map(([, x]) => x)
  const x0 = Math.min(0, ...xs)
  const x1 = Math.max(...xs)
  const y0 = Math.min(...ys)
  const y1 = Math.max(...ys)
  const pad = Math.max(x1 - x0, y1 - y0) * 0.04
  const top = y0 - pad - (y1 - y0) * 0.12 // room for rib names above the leading edge
  return { x: x0 - pad, y: top, w: x1 - x0 + 2 * pad, h: y1 - top + pad, chord: y1 - y0 }
})
const zoom = reactive({ k: 1, cx: null, cy: null }) // k: magnification; centre in world units
// The element's size, so the view box has its proportions and the drawing (and grid) fill it
const el = reactive({ w: 600, h: 300 })
let sizeObs = null
onMounted(() => {
  const measure = () => {
    if (!svgEl.value) return
    el.w = svgEl.value.clientWidth || el.w
    el.h = svgEl.value.clientHeight || el.h
  }
  measure()
  sizeObs = new ResizeObserver(measure)
  sizeObs.observe(svgEl.value)
  // Belt and braces where ResizeObserver doesn't fire (a hidden pane): measure on window
  // resizes and whenever the pointer comes over the plan
  window.addEventListener('resize', measure)
  svgEl.value.addEventListener('pointerenter', measure)
  // Non-passive so the wheel can be stopped from scrolling the page while the view has focus
  svgEl.value.addEventListener('wheel', onWheel, { passive: false })
  remeasure = measure
})
let remeasure = () => {}
onBeforeUnmount(() => {
  sizeObs?.disconnect()
  window.removeEventListener('resize', remeasure)
})
// Space kept clear of the rail (when editing) and the controls along the top and bottom, px
// Layers: what's drawn
const show = reactive({ sheeting: true, edges: true, stringers: true, spar: true, surfaces: true, hinges: true, brakes: true, servos: true, servoPlates: true, ribs: true })
const LAYERS = [
  { id: 'sheeting', label: 'Sheeting' },
  { id: 'edges', label: 'Leading/Trailing edges' },
  { id: 'spar', label: 'Spar' },
  { id: 'stringers', label: 'Stringers' },
  { id: 'ribs', label: 'Ribs' },
  { id: 'surfaces', label: 'Control surfaces' },
  { id: 'hinges', label: 'Hinge spars and tabs' },
  { id: 'servos', label: 'Servos' },
  { id: 'servoPlates', label: 'Servo plates and hatches' },
  { id: 'brakes', label: 'Air brakes' },
]
const present = computed(() => ({
  sheeting: !!geom.value.sheet || geom.value.patches.length > 0,
  edges: true,
  spar: props.analysis.structure?.spar.type !== 'none',
  stringers: geom.value.stringers.length > 0,
  ribs: ribLines.value.length > 0,
  surfaces: geom.value.hinges.length > 0,
  hinges: geom.value.hinges.length > 0,
  servos: geom.value.servos.length > 0,
  servoPlates: geom.value.servos.length > 0,
  brakes: geom.value.brakes.length > 0,
}))
const layersOpen = ref(false)
const layersEl = ref(null)
function onLayersOutside(e) {
  if (layersOpen.value && !layersEl.value?.contains(e.target)) layersOpen.value = false
}
function onLayersKey(e) {
  if (e.key === 'Escape' && layersOpen.value) {
    e.stopPropagation()
    layersOpen.value = false
  }
}
watch(layersOpen, (open) => {
  if (typeof document === 'undefined') return
  if (open) document.addEventListener('pointerdown', onLayersOutside, true)
  else document.removeEventListener('pointerdown', onLayersOutside, true)
})
onBeforeUnmount(() => typeof document !== 'undefined' && document.removeEventListener('pointerdown', onLayersOutside, true))

const inset = computed(() => ({ left: props.editable ? 76 : 8, right: 8, top: 40, bottom: 40 }))
const vb = computed(() => {
  const f = fit.value
  const ins = inset.value
  // Fit the wing inside the space the controls leave, then zoom
  const aw = Math.max(40, el.w - ins.left - ins.right)
  const ah = Math.max(40, el.h - ins.top - ins.bottom)
  const ppm = Math.min(aw / f.w, ah / f.h) * zoom.k // pixels per metre
  const w = el.w / ppm
  const h = el.h / ppm
  // Fitted, the wing's centre sits in the middle of that space
  const cx = zoom.cx ?? f.x + f.w / 2 - (ins.left - ins.right) / 2 / ppm
  const cy = zoom.cy ?? f.y + f.h / 2 - (ins.top - ins.bottom) / 2 / ppm
  return { x: cx - w / 2, y: cy - h / 2, w, h }
})
const font = computed(() => (fit.value.chord * 0.07) / Math.sqrt(zoom.k))
function fitView() {
  zoom.k = 1
  zoom.cx = null
  zoom.cy = null
}
// Refit when the wing itself changes shape, not when ribs move
watch(
  () => [fit.value.w, fit.value.h],
  () => fitView(),
)

const svgEl = ref(null)
function toWorld(e) {
  const m = svgEl.value.getScreenCTM()
  const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse())
  return { s: p.x, x: p.y }
}
const pxPerMetre = () => el.w / vb.value.w
// The sheeting hatch, a fixed number of pixels apart whatever the zoom
const hatchId = `wc-sp-hatch-${useId()}`
const hatch = computed(() => ({ step: 7 / pxPerMetre(), width: 1 / pxPerMetre() }))

// Zoom about the middle of the view, as the buttons and + and − do
function zoomBy(f) {
  const v = vb.value
  const k = Math.min(60, Math.max(0.15, zoom.k * f))
  zoom.cx = v.x + v.w / 2
  zoom.cy = v.y + v.h / 2
  zoom.k = k
}

function onWheel(e) {
  // Zoom only while the view has focus; otherwise let the page scroll
  if (!svgEl.value?.contains(document.activeElement)) return
  e.preventDefault()
  const before = toWorld(e)
  const v = vb.value
  // Zoom out past the fitted view as well as in, like the wing plan editor
  const k = Math.min(60, Math.max(0.15, zoom.k * Math.exp(-e.deltaY * 0.0015)))
  // Keep the point under the pointer where it is
  const f = k / zoom.k
  const cx = v.x + v.w / 2
  const cy = v.y + v.h / 2
  zoom.cx = before.s + (cx - before.s) / f
  zoom.cy = before.x + (cy - before.x) / f
  zoom.k = k
}

// --- Grid and snapping -----------------------------------------------------------------------

const STEPS = {
  metric: [0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1],
  imperial: [1 / 32, 1 / 16, 1 / 8, 1 / 4, 1 / 2, 1, 2].map((i) => i * 0.0254),
}
const step = computed(() => {
  const list = STEPS[systemOf(props.system)]
  return list.find((s) => s * pxPerMetre() >= 8) ?? list.at(-1)
})
const snapOn = ref(true)
const grid = computed(() => {
  const v = vb.value
  const s = step.value
  const major = systemOf(props.system) === 'imperial' ? 4 : 5
  const s0 = a.value.rootS // spanwise lines measured from the root rib
  const lines = []
  for (let i = Math.ceil((v.x - s0) / s); s0 + i * s <= v.x + v.w; i++) lines.push({ v: true, p: s0 + i * s, major: i % major === 0 })
  for (let i = Math.ceil(v.y / s); i * s <= v.y + v.h; i++) lines.push({ v: false, p: i * s, major: i % major === 0 })
  return lines.length < 600 ? lines : []
})
const snap = (d, e) => (snapOn.value && !e?.altKey ? Math.round(d / step.value) * step.value : d)

// --- Editing ---------------------------------------------------------------------------------

const partFor = (id) => ribs.value.find((p) => p.id === id) ?? surfaceRibs.value.find((p) => p.id === id)
const selectedPart = computed(() => partFor(props.selected))
const nextId = (list) => list.reduce((m, x) => Math.max(m, x.id ?? 0), 0) + 1

function setDistance(p, d) {
  const key = p.kind === 'hard' ? 'hardPoints' : 'manual'
  const r = structure.value.ribs
  structure.value = { ...structure.value, ribs: { ...r, [key]: r[key].map((m) => (m.id === p.sourceId ? { ...m, d } : m)) } }
}
const clampD = (d) => Math.min(a.value.tipS - a.value.rootS - 0.003, Math.max(0.003, d))

// After adding a rib, select it once it appears (rib names follow the order along the span)
const pendingSource = ref(null)
watch(ribs, (list) => {
  if (pendingSource.value === null) return
  const p = list.find((q) => q.kind === 'manual' && q.sourceId === pendingSource.value)
  if (p) emit('select', p.id)
  pendingSource.value = null
})
function addAt(d) {
  const r = structure.value.ribs
  const id = nextId(r.manual ?? [])
  structure.value = { ...structure.value, ribs: { ...r, manual: [...(r.manual ?? []), { id, d: clampD(d) }] } }
  pendingSource.value = id
  emit('commit')
}
// A rib mid-way along the longest bay, snapped to the grid
function addInLongestBay() {
  const list = ribs.value
  let best = null
  for (let i = 1; i < list.length; i++) {
    const gap = list[i].s - list[i - 1].s
    if (!best || gap > best.gap) best = { gap, mid: (list[i].s + list[i - 1].s) / 2 }
  }
  if (best) addAt(snap(best.mid - a.value.rootS))
}
function removeSelected() {
  const p = selectedPart.value
  if (!p || !movable(p)) return
  const key = p.kind === 'hard' ? 'hardPoints' : 'manual'
  const r = structure.value.ribs
  structure.value = { ...structure.value, ribs: { ...r, [key]: r[key].filter((m) => m.id !== p.sourceId) } }
  emit('commit')
}

// Dragging: the rib follows the pointer as a preview, and moves for real on release (moving
// it rebuilds every part, which is too slow to do on every pointer move)
const drag = ref(null) // { part, d, moved, startX, startY }
const pan = ref(null) // { x, y, cx, cy }
function onRibDown(e, line) {
  emit('select', line.id)
  svgEl.value.focus({ preventScroll: true })
  if (!line.movable) return
  e.stopPropagation()
  svgEl.value.setPointerCapture(e.pointerId)
  const p = partFor(line.id)
  drag.value = { part: p, d: p.s - a.value.rootS, moved: false, startX: e.clientX, startY: e.clientY }
}
function onBackgroundDown(e) {
  svgEl.value.focus({ preventScroll: true })
  svgEl.value.setPointerCapture(e.pointerId)
  const v = vb.value
  pan.value = { x: e.clientX, y: e.clientY, cx: v.x + v.w / 2, cy: v.y + v.h / 2, moved: false }
}
function onMove(e) {
  if (drag.value) {
    const dr = drag.value
    if (Math.hypot(e.clientX - dr.startX, e.clientY - dr.startY) > 3) dr.moved = true
    if (dr.moved) dr.d = clampD(snap(toWorld(e).s - a.value.rootS, e))
  } else if (pan.value) {
    if (Math.hypot(e.clientX - pan.value.x, e.clientY - pan.value.y) > 3) pan.value.moved = true
    const k = 1 / pxPerMetre()
    zoom.cx = pan.value.cx - (e.clientX - pan.value.x) * k
    zoom.cy = pan.value.cy - (e.clientY - pan.value.y) * k
  }
}
function onUp() {
  if (drag.value?.moved) {
    setDistance(drag.value.part, drag.value.d)
    emit('commit')
  }
  drag.value = null
  pan.value = null
}
function onDblClick(e) {
  if (!props.editable) return
  const w = toWorld(e)
  if (w.s <= a.value.rootS || w.s >= a.value.tipS) return
  addAt(snap(w.s - a.value.rootS, e))
}
function onKey(e) {
  if (e.ctrlKey || e.metaKey) return
  const k = e.key.toLowerCase()
  // View: F fits, + and − zoom; when editing, A adds a rib in the longest bay
  if (k === 'f') fitView()
  else if (k === '+' || k === '=') zoomBy(1.25)
  else if (k === '-' || k === '_') zoomBy(1 / 1.25)
  else if (props.editable && k === 'a') addInLongestBay()
  else return onEditKey(e)
  e.preventDefault()
}
function onEditKey(e) {
  const p = selectedPart.value
  if ((e.key === 'Delete' || e.key === 'Backspace') && p && movable(p)) {
    e.preventDefault()
    removeSelected()
  } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && p && movable(p)) {
    e.preventDefault()
    const by = step.value * (e.shiftKey ? 10 : 1) * (e.key === 'ArrowLeft' ? -1 : 1)
    setDistance(p, clampD(snap(p.s - a.value.rootS + by)))
  }
}

// The dragged rib's preview line, and the readout for the selected (or dragged) rib
const preview = computed(() => {
  const dr = drag.value
  if (!dr?.moved) return null
  const s = a.value.rootS + dr.d
  const sec = a.value.section(s)
  return { s, y1: sec.xl + a.value.structure.le.width, y2: sec.xl + sec.c - a.value.structure.te.width }
})
const KINDS = { root: 'Root rib', break: 'Panel break', tip: 'Tip rib', hard: 'Hard point', manual: 'Manual rib', normal: 'Rib', surface: 'Control surface end rib' }
const readout = computed(() => {
  const p = selectedPart.value
  if (!p) return null
  const list = ribs.value
  const s = preview.value ? preview.value.s : p.s
  // A control surface's rib: which surface, no bays (it sits behind the wing's ribs)
  if (p.group === 'surfaces') {
    const sf = (a.value.surfaces ?? []).find((x) => x.id === p.surface)
    return { name: p.name, kind: `${sf?.label ?? 'Control surface'} rib`, d: fmt(s - a.value.rootS), bays: '', movable: false }
  }
  const i = list.indexOf(p)
  const before = i > 0 ? s - list[i - 1].s : null
  const after = i < list.length - 1 ? list[i + 1].s - s : null
  const hp = p.kind === 'hard' ? (structure.value.ribs.hardPoints ?? []).find((h) => h.id === p.sourceId) : null
  const end =
    p.kind === 'hard' && !hp
      ? (a.value.surfaces ?? []).find((x) => x.ok && (Math.abs(x.s0 - p.s) < 1e-6 || Math.abs(x.s1 - p.s) < 1e-6)) ??
        (a.value.brakes ?? []).find((x) => x.ok && (Math.abs(x.sA - p.s) < 1e-6 || Math.abs(x.sB - p.s) < 1e-6))
      : null
  return {
    name: p.name,
    kind: hp?.label ? `${KINDS.hard}: ${hp.label}` : end ? `End of ${end.label}` : KINDS[p.kind] ?? 'Rib',
    d: fmt(s - a.value.rootS),
    bays: [before, after].filter((v) => v !== null).map(fmt).join(' and '),
    movable: movable(p),
  }
})

const poly = (pts) => pts.map(([s, x]) => `${s.toFixed(5)},${x.toFixed(5)}`).join(' ')
const fuselage = computed(() => {
  const an = a.value
  const half = an.sampler.half
  if (!(half > 0) || an.rootS >= half) return null
  return poly([
    [0, 0],
    [half, 0],
    [half, an.wing.rootChord],
    [0, an.wing.rootChord],
  ])
})
const labelEvery = computed(() => Math.max(1, Math.ceil(ribs.value.length / (24 * zoom.k))))
</script>

<template>
  <figure class="wc-figure wc-structure-plan">
    <div class="wc-plan__stage">
      <svg
        ref="svgEl"
        :viewBox="`${vb.x} ${vb.y} ${vb.w} ${vb.h}`"
        preserveAspectRatio="xMidYMid meet"
        class="wc-structure-plan__svg"
        :class="{ 'wc-structure-plan__svg--panning': pan }"
        tabindex="0"
        role="img"
        aria-label="Wing structure seen from above, one side"
        @pointerdown="onBackgroundDown"
        @pointermove="onMove"
        @pointerup="onUp"
        @pointercancel="onUp"
        @dblclick="onDblClick"
        @keydown="onKey"
      >
        <defs>
          <!-- Stroke width in user units: non-scaling strokes inside a pattern tile aren't dependable -->
          <pattern :id="hatchId" patternUnits="userSpaceOnUse" :width="hatch.step" :height="hatch.step" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" :y2="hatch.step" :stroke-width="hatch.width" class="wc-sp__hatch-line" />
          </pattern>
        </defs>
        <g pointer-events="none">
          <line
            v-for="(l, i) in grid"
            :key="'g' + i"
            :x1="l.v ? l.p : vb.x"
            :x2="l.v ? l.p : vb.x + vb.w"
            :y1="l.v ? vb.y : l.p"
            :y2="l.v ? vb.y + vb.h : l.p"
            :class="l.major ? 'wc-plan__major' : 'wc-plan__minor'"
          />
        </g>
        <rect
          v-for="(b, i) in weak"
          :key="'w' + i"
          :x="b.s0"
          :y="vb.y"
          :width="b.s1 - b.s0"
          :height="vb.h"
          class="wc-sp__weak"
          :class="`wc-sp__weak--${b.kind}`"
        >
          <title>Short of strength: {{ b.title }}</title>
        </rect>
        <g pointer-events="none">
          <polygon v-if="fuselage" :points="fuselage" class="wc-sp__outline" />
          <polygon v-for="p in flat.panels" :key="'p' + p.index" :points="poly(p.polygon)" class="wc-sp__outline" />
          <polygon v-if="flat.tip" :points="poly(flat.tip.polygon)" class="wc-sp__outline wc-sp__tip" />
          <template v-for="(p, i) in show.sheeting ? geom.patches : []" :key="'hp' + i">
            <polygon :points="p" class="wc-sp__sheet" />
            <polygon :points="p" class="wc-sp__sheet-hatch" :fill="`url(#${hatchId})`" />
          </template>
          <template v-if="geom.sheet && show.sheeting">
            <polygon :points="geom.sheet" class="wc-sp__sheet" />
            <polygon :points="geom.sheet" class="wc-sp__sheet-hatch" :fill="`url(#${hatchId})`" />
          </template>
          <template v-if="show.edges">
            <polyline :points="geom.le" class="wc-sp__stock" />
            <polyline :points="geom.te" class="wc-sp__stock" />
          </template>
          <template v-if="show.stringers"><polyline v-for="(s, i) in geom.stringers" :key="'s' + i" :points="s" class="wc-sp__stringer" /></template>
          <polygon v-if="analysis.structure?.spar.type !== 'none' && show.spar" :points="geom.spar" class="wc-sp__spar" />
          <template v-for="h in geom.hinges" :key="'h' + h.id">
            <polygon v-if="show.surfaces" :points="h.outline" class="wc-sp__surface" />
            <template v-if="show.hinges">
              <polygon :points="h.fixed" class="wc-sp__hinge" />
              <polygon :points="h.moving" class="wc-sp__hinge" />
              <polygon v-for="(t, k) in h.tabs" :key="k" :points="t" class="wc-sp__tab" />
            </template>
          </template>
          <template v-for="r in show.brakes ? geom.brakes : []" :key="'ab' + r.id">
            <polygon :points="r.box" class="wc-sp__brake"><title>{{ r.label }}: {{ r.type === 'blade' ? 'box between its ribs' : 'frame under the top surface' }}</title></polygon>
            <polygon v-for="(o, k) in r.openings" :key="k" :points="o" class="wc-sp__slot" />
            <polyline v-if="r.hinge" :points="r.hinge" class="wc-sp__brake-hinge" />
          </template>
          <template v-for="b in show.servoPlates ? geom.servos : []" :key="'bp' + b.id">
            <polygon :points="b.hatch" class="wc-sp__hatch"><title>{{ b.label }}: mount plate, and the hatch in the lower surface under it</title></polygon>
          </template>
          <template v-for="b in show.servos ? geom.servos : []" :key="'b' + b.id">
            <polyline :points="b.lead" class="wc-sp__lead" />
            <polygon :points="b.body" class="wc-sp__servo" />
          </template>
        </g>
        <g
          v-for="(r, i) in show.ribs ? ribLines : []"
          :key="r.id"
          class="wc-sp__rib"
          :class="{
            'wc-sp__rib--selected': r.id === selected,
            'wc-sp__rib--hard': r.kind !== 'normal' && r.kind !== 'manual' && r.kind !== 'surface',
            'wc-sp__rib--movable': r.movable,
            'wc-sp__rib--dragging': drag?.moved && drag.part.id === r.id,
          }"
        >
          <line :x1="r.x1" :y1="r.y1" :x2="r.x2" :y2="r.y2" class="wc-sp__ribline" />
          <line :x1="r.x1" :y1="r.y1" :x2="r.x2" :y2="r.y2" class="wc-sp__ribhit" @pointerdown.stop="onRibDown($event, r)">
            <title>{{ r.name }}{{ r.movable ? ': drag to move' : '' }}</title>
          </line>
          <text
            v-if="(!r.surface && i % labelEvery === 0) || r.id === selected"
            :x="r.x1"
            :y="r.y1 - font * 0.6"
            :font-size="font"
            text-anchor="middle"
            class="wc-sp__label"
          >
            {{ r.name }}
          </text>
        </g>
        <line v-if="preview" :x1="preview.s" :x2="preview.s" :y1="preview.y1" :y2="preview.y2" class="wc-sp__preview" />
      </svg>
      <div class="wc-stage__corner wc-stage__corner--tl" role="toolbar" aria-label="Show">
        <div ref="layersEl" class="wc-3d__menu" @keydown="onLayersKey">
          <button type="button" class="wc-button wc-stage__btn" :aria-expanded="String(layersOpen)" :aria-controls="`${hatchId}-layers`" title="Show and hide parts" @click="layersOpen = !layersOpen">
            Layers
          </button>
          <div v-if="layersOpen" :id="`${hatchId}-layers`" class="wc-layers" role="group" aria-label="Layers">
            <h4 class="wc-layers__head">Show</h4>
            <ul class="wc-layers__rows">
              <li v-for="l in LAYERS.filter((x) => present[x.id])" :key="l.id" class="wc-layers__row" :class="{ 'wc-layers__row--off': !show[l.id] }">
                <span class="wc-layers__name">{{ l.label }}</span>
                <button type="button" class="wc-layers__icon" :aria-pressed="String(show[l.id])" :title="`${show[l.id] ? 'Hide' : 'Show'} ${l.label.toLowerCase()}`" @click="show[l.id] = !show[l.id]">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path v-for="(d, k) in show[l.id] ? EYE : EYE_OFF" :key="k" :d="d" /></svg>
                </button>
              </li>
            </ul>
          </div>
        </div>
      </div>
      <div v-if="editable" class="wc-cmd" role="toolbar" :aria-label="readout?.movable ? readout.name : 'Ribs'">
        <template v-if="readout?.movable">
          <span class="wc-cmd__label">{{ readout.name }}</span>
          <button type="button" class="wc-cmd__btn" title="Delete this rib (Delete)" @click="removeSelected">Delete</button>
          <span class="wc-cmd__sep" aria-hidden="true" />
        </template>
        <button type="button" class="wc-cmd__btn" title="Add a rib mid-way along the longest bay (A). Or double-click the wing to add one there." @click="addInLongestBay">
          Add rib
        </button>
      </div>
      <StageZoom v-model:snap="snapOn" :snap-step="editable ? fmt(step) : ''" fit-title="Fit the wing to the view (F)" @zoom-in="zoomBy(1.25)" @zoom-out="zoomBy(1 / 1.25)" @fit="fitView" />
    </div>
    <p v-if="readout" class="wc-plan__readout wc-structure-plan__readout">
      <strong>{{ readout.name }}</strong> {{ readout.kind }}, {{ readout.d }} from the root rib<template v-if="readout.bays"
        >; bays {{ readout.bays }}</template
      >.
      <template v-if="readout.movable"> Drag it, or nudge with the arrow keys; Delete removes it.</template>
    </p>
    <figcaption class="wc-figure__caption">
      One side, flat as built, leading edge at the top.{{ analysis.structure?.spar.type === 'none' ? ' No spar' : ' Spar in accent colour' }}<template v-if="geom.sheet">,
        sheeted area hatched</template
      ><template v-if="geom.hinges.length">, control surfaces shaded behind their hinge spars</template
      ><template v-if="geom.brakes.length">; air brakes outlined, with the slots or opening in the covering</template
      ><template v-if="geom.servos.length">; servo bays with their hatch outlined, the servo filled and its lead's route dashed to the root</template
      ><template v-if="weakKinds.has('strength')">; red bays are short of strength in the spar, web or sheeting, which
        closer ribs won't fix (see the warnings)</template
      ><template v-if="weakKinds.has('spacing')">; amber bays have ribs too far apart</template>. Scroll to zoom, drag to
      move around.
      <template v-if="editable">Double-click the wing to add a rib there.</template>
      <template v-else-if="a.construction === 'foam'">A foam wing has no ribs: its cores are cut between the panel ends, and the servo and air brake pockets are routed where outlined.</template>
      <template v-else>Click a rib to see it; set spacing to Manual to move ribs here.</template>
    </figcaption>
  </figure>
</template>
