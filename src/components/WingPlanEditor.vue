<script setup>
// CAD-style plan editor for the half wing, drawn flat (as built). Drag the handles to change
// root chord, fuselage width, each panel's length, sweep and tip chord, curved edges, chord
// stations and the rounded tip. The measure tool places dimensions, which snap to the wing's
// key points and follow them as the wing changes. Control surfaces are drawn on their panels,
// to select, add (from the command bar, on the selected panel) and delete. Numeric entry lives
// in PanelEditor and ControlSurfaceEditor.
import { ref, reactive, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { flatPanels, appendPanel, removePanel, insertPanel, movePanel, keyPoints, addStation, panelMode, checkStations, wingSampler } from '../lib/wing.js'
import { resolveSurfaces, surfaceOutline, addSurface } from '../lib/controlSurfaces.js'
import { dropBay } from '../lib/servos.js'
import { format, defaultUnit, systemOf } from '../lib/units.js'
import { MEASURE } from '../lib/icons.js'
import StageZoom from './StageZoom.vue'

const props = defineProps({
  system: { type: [String, Object], required: true }, // a units setting (units.js normaliseUnits) or system name
  // Fill the parent's height (the expanded editor) instead of a fixed height.
  fill: { type: Boolean, default: false },
})
const emit = defineEmits(['commit'])
const rootChord = defineModel('rootChord', { type: Number, default: null })
const fuselageWidth = defineModel('fuselageWidth', { type: Number, default: 0 })
const panels = defineModel('panels', { type: Array, required: true })
const tip = defineModel('tip', { type: Object, default: null })
const dimensions = defineModel('dimensions', { type: Array, default: () => [] })
const selected = defineModel('selected', { type: Number, default: null })
// Control surfaces (controlSurfaces.js) and the selected one's id
const controls = defineModel('controls', { type: Object, default: null })
const selectedSurface = defineModel('selectedSurface', { type: Number, default: null })

const FIXED_HEIGHT = 360
const height = ref(FIXED_HEIGHT)
const HANDLE_PX = 6
const SNAP_PX = 10
const wrapEl = ref(null)
const stageEl = ref(null) // the drawing area, under the corner controls and the command bar
const svgEl = ref(null)
const width = ref(600)
const view = reactive({ ox: -0.05, oy: -0.1, scale: 400 }) // world origin of the top-left, px per metre
const snapOn = ref(true)
const tool = ref('select') // 'select' | 'measure'
const drag = ref(null)
const hoverSnap = ref(null) // key point under the pointer in measure mode
const selectedDim = ref(null)

const lengthUnit = computed(() => defaultUnit(props.system, 'length'))
const fmt = (v) => format(v, 'length', lengthUnit.value)

const wingState = () => ({
  fuselageWidth: fuselageWidth.value,
  rootChord: rootChord.value,
  panels: panels.value,
  tip: tip.value,
})
const plan = computed(() => flatPanels(wingState()))
// The control surfaces placed on the wing, those that can be drawn
const sampler = computed(() => wingSampler(wingState()))
const surfaces = computed(() => {
  if (!sampler.value || !controls.value) return []
  return resolveSurfaces(sampler.value, controls.value.surfaces)
    .filter((r) => r.ok || r.problem === 'overlap')
    .map((r) => {
      // An overlapping one isn't built, but it's drawn (in the warning colour) so it can be found
      const placed = r.ok ? r : { ...r, ok: true }
      return { ...r, outline: pts(surfaceOutline(sampler.value, placed)), hinge: [r.s0, r.x0, r.s1, r.x1] }
    })
})
const selSurface = computed(() => surfaces.value.find((r) => r.id === selectedSurface.value) ?? null)
const points = computed(() => keyPoints(wingState()))
const pointMap = computed(() => new Map(points.value.map((p) => [p.id, p])))
const half = computed(() => Math.max(0, fuselageWidth.value || 0) / 2)

const viewBox = computed(() => `${view.ox} ${view.oy} ${width.value / view.scale} ${height.value / view.scale}`)
const px = (n) => n / view.scale // screen pixels to world metres

// Grid step (and snap increment): the smallest "nice" step in the current unit system at
// least 8 px apart, so snapping stays fine enough for real dimensions at any zoom.
const STEPS = {
  metric: [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1],
  imperial: [1 / 16, 1 / 8, 1 / 4, 1 / 2, 1, 2, 6, 12, 24].map((i) => i * 0.0254),
}
const step = computed(() => {
  const list = STEPS[systemOf(props.system)]
  return list.find((s) => s * view.scale >= 8) ?? list.at(-1)
})
const majorEvery = computed(() => (systemOf(props.system) === 'metric' ? 5 : 4))

const grid = computed(() => {
  const s = step.value
  const x0 = view.ox
  const y0 = view.oy
  const x1 = x0 + width.value / view.scale
  const y1 = y0 + height.value / view.scale
  const lines = []
  for (let i = Math.ceil(x0 / s); i * s <= x1; i++) lines.push({ v: true, p: i * s, major: i % majorEvery.value === 0 })
  for (let i = Math.ceil(y0 / s); i * s <= y1; i++) lines.push({ v: false, p: i * s, major: i % majorEvery.value === 0 })
  return { lines, x0, x1, y0, y1 }
})

const snap = (v, e) => (snapOn.value && !e?.altKey ? Math.round(v / step.value) * step.value : v)

// --- Fit and zoom --------------------------------------------------------------------

function bounds() {
  let sMax = Math.max(0.05, half.value)
  let xMin = 0
  let xMax = rootChord.value || 0.2
  const polys = [...plan.value.panels.map((p) => p.polygon), ...(plan.value.tip ? [plan.value.tip.polygon] : [])]
  for (const poly of polys) {
    for (const [s, x] of poly) {
      sMax = Math.max(sMax, s)
      xMin = Math.min(xMin, x)
      xMax = Math.max(xMax, x)
    }
  }
  return { sMin: -0.08 * sMax, sMax, xMin, xMax }
}

// Space kept clear of the command bar and Measure (top) and the corner controls (bottom), in
// pixels
const INSET = { left: 12, top: 44, right: 12, bottom: 44 }
function fit() {
  const b = bounds()
  const w = b.sMax - b.sMin
  const h = Math.max(b.xMax - b.xMin, 0.01)
  const aw = Math.max(40, width.value - INSET.left - INSET.right)
  const ah = Math.max(40, height.value - INSET.top - INSET.bottom)
  const scale = Math.min((aw * 0.94) / w, (ah * 0.9) / h)
  if (!Number.isFinite(scale) || scale <= 0) return
  view.scale = scale
  view.ox = b.sMin - (INSET.left + (aw - w * scale) / 2) / scale
  view.oy = b.xMin - (INSET.top + (ah - h * scale) / 2) / scale
}

function zoomAt(factor, sx, sy) {
  const wx = view.ox + sx / view.scale
  const wy = view.oy + sy / view.scale
  view.scale = Math.min(20000, Math.max(20, view.scale * factor))
  view.ox = wx - sx / view.scale
  view.oy = wy - sy / view.scale
}

const zoomBy = (k) => zoomAt(k, width.value / 2, height.value / 2)

function onWheel(e) {
  e.preventDefault()
  const r = svgEl.value.getBoundingClientRect()
  zoomAt(Math.exp(-e.deltaY * 0.0015), ((e.clientX - r.left) / r.width) * width.value, ((e.clientY - r.top) / r.height) * height.value)
}

// --- Edits made here (not auto-fitted) ------------------------------------------------

// Changes made by this editor run through own(), so the auto-fit watcher (which re-frames
// the view after changes made elsewhere: the inputs column, undo, opening a project) skips
// them. The flag clears in a microtask queued after the change, i.e. once Vue has flushed
// the update and the watcher has seen it, so an edit that changes nothing can't leave it set.
let ownEdit = false
function own(fn) {
  ownEdit = true
  fn()
  queueMicrotask(() => {
    ownEdit = false
  })
}

function setPanel(i, patch) {
  own(() => (panels.value = panels.value.map((p, j) => (j === i ? { ...p, ...patch } : p))))
}

function setStation(i, id, patch) {
  own(() => (panels.value = panels.value.map((p, j) =>
    j === i ? { ...p, stations: p.stations.map((st) => (st.id === id ? { ...st, ...patch } : st)) } : p,
  )))
}

// --- Pointer handling ----------------------------------------------------------------

// Pointer position in world metres. Maps through the rendered size rather than the width
// we last measured, so it stays right even if a resize hasn't been observed yet.
function world(e) {
  const r = svgEl.value.getBoundingClientRect()
  const vw = width.value / view.scale
  const vh = height.value / view.scale
  return { s: view.ox + ((e.clientX - r.left) / r.width) * vw, x: view.oy + ((e.clientY - r.top) / r.height) * vh }
}

// Nearest key point within SNAP_PX of a world position, or null.
function nearestPoint(w) {
  let best = null
  let bestD = px(SNAP_PX)
  for (const p of points.value) {
    const d = Math.hypot(p.s - w.s, p.x - w.x)
    if (d < bestD) {
      best = p
      bestD = d
    }
  }
  return best
}

// A dimension endpoint: attached to a key point if one is close, else snapped to the grid.
function measurePoint(e) {
  const w = world(e)
  const kp = e.altKey ? null : nearestPoint(w)
  if (kp) return { ref: kp.id, s: kp.s, x: kp.x }
  return { ref: null, s: snap(w.s, e), x: snap(w.x, e) }
}

function startHandle(e, kind, i = null, extra = {}) {
  if (tool.value === 'measure') return startMeasure(e)
  e.stopPropagation()
  e.preventDefault()
  wrapEl.value?.focus({ preventScroll: true })
  e.currentTarget.setPointerCapture(e.pointerId)
  if (i !== null) selected.value = i
  if (kind === 'mle' || kind === 'mte') {
    // Grabbing the midpoint of a straight edge turns it into a curve.
    setPanel(i, { [kind === 'mle' ? 'le' : 'te']: { u: 0.5, d: 0 } })
    kind = kind === 'mle' ? 'cle' : 'cte'
  }
  drag.value = { kind, i, ...extra }
}

function startMeasure(e) {
  if (e.button !== 0) return
  e.stopPropagation()
  e.preventDefault()
  wrapEl.value?.focus({ preventScroll: true })
  svgEl.value.setPointerCapture(e.pointerId)
  const a = measurePoint(e)
  drag.value = { kind: 'measure', a, b: { ...a }, shift: e.shiftKey }
}

function moveHandle(e) {
  const d = drag.value
  if (!d) {
    if (tool.value === 'measure') hoverSnap.value = e.altKey ? null : nearestPoint(world(e))
    return
  }
  const w = world(e)
  if (d.kind === 'pan') {
    const r = svgEl.value.getBoundingClientRect()
    view.ox = d.ox - ((e.clientX - d.cx) / r.width) * (width.value / view.scale)
    view.oy = d.oy - ((e.clientY - d.cy) / r.height) * (height.value / view.scale)
    d.moved ||= Math.hypot(e.clientX - d.cx, e.clientY - d.cy) > 3
    return
  }
  if (d.kind === 'measure') {
    d.b = measurePoint(e)
    d.shift = e.shiftKey
    hoverSnap.value = d.b.ref ? pointMap.value.get(d.b.ref) : null
    return
  }
  if (d.kind === 'root') {
    own(() => (rootChord.value = Math.max(0.02, snap(w.x, e))))
    return
  }
  if (d.kind === 'fuse') {
    own(() => (fuselageWidth.value = Math.min(0.5, Math.max(0, snap(w.s, e) * 2))))
    return
  }
  if (d.kind === 'tip') {
    const base = plan.value.tip?.base
    if (!base) return
    const peak = base.c > 0 ? (snap(w.x, e) - base.x) / base.c : 0.5
    own(() => (tip.value = { extension: Math.max(0.005, snap(w.s, e) - base.s), peak: Math.min(1, Math.max(0, peak)) }))
    return
  }
  const p = plan.value.panels[d.i]
  if (!p) return
  const { inner, outer } = p
  if (d.kind === 'le') {
    const patch = { length: Math.max(0.005, snap(w.s, e) - inner.s) }
    // Shift keeps the sweep as it was, for a pure change of length.
    if (!e.shiftKey) patch.sweep = snap(w.x, e) - inner.x
    setPanel(d.i, patch)
  } else if (d.kind === 'te') {
    setPanel(d.i, { tipChord: Math.max(0, snap(w.x, e) - outer.x) })
  } else if (d.kind === 'cle' || d.kind === 'cte') {
    const L = outer.s - inner.s
    const u = Math.min(0.95, Math.max(0.05, (w.s - inner.s) / L))
    const x0 = d.kind === 'cle' ? inner.x : inner.x + inner.c
    const x1 = d.kind === 'cle' ? outer.x : outer.x + outer.c
    const straight = x0 + (x1 - x0) * u
    setPanel(d.i, { [d.kind === 'cle' ? 'le' : 'te']: { u, d: snap(w.x, e) - straight } })
  } else if (d.kind === 'sle') {
    // Station leading edge: moves the station along the panel and sets its set-back (or,
    // with a straight line kept, just moves it along).
    const L = p.panel.length
    const dist = Math.min(L - 0.001, Math.max(0.001, snap(w.s, e) - inner.s))
    if (Number.isFinite(p.panel.straightLine)) setStation(d.i, d.station, { d: dist })
    else setStation(d.i, d.station, { d: dist, le: snap(w.x, e) - inner.x })
  } else if (d.kind === 'ste') {
    const st = p.panel.stations.find((q) => q.id === d.station)
    if (!st || !p.edges) return
    const xl = p.edges.le(st.d / p.panel.length)
    if (Number.isFinite(p.panel.straightLine)) {
      // With a straight line kept, the trailing edge sits (1 - at) of the chord behind it.
      const at = p.panel.straightLine
      const ref = xl + at * st.chord
      setStation(d.i, d.station, { chord: Math.max(0, (snap(w.x, e) - ref) / Math.max(1 - at, 0.05)) })
    } else setStation(d.i, d.station, { chord: Math.max(0, snap(w.x, e) - xl) })
  }
}

function endHandle() {
  const d = drag.value
  drag.value = null
  if (!d) return
  if (d.kind === 'pan') {
    if (!d.moved && d.deselect) {
      selected.value = null
      selectedDim.value = null
      selectedSurface.value = null
    }
    return
  }
  if (d.kind === 'measure') {
    const a = d.a
    const b = d.b
    if (Math.hypot(b.s - a.s, b.x - a.x) > px(4)) {
      emit('commit')
      const kind = d.shift ? (Math.abs(b.s - a.s) >= Math.abs(b.x - a.x) ? 'span' : 'chord') : 'aligned'
      const id = dimensions.value.reduce((m, q) => Math.max(m, q.id ?? 0), 0) + 1
      dimensions.value = [...dimensions.value, { id, a, b, kind }]
      selectedDim.value = id
    }
    return
  }
  // Each completed drag is its own undo step.
  emit('commit')
}

function startPan(e, { deselect = false, select = null, surface = null } = {}) {
  if (tool.value === 'measure') return startMeasure(e)
  if (e.button !== 0 && e.button !== 1) return
  wrapEl.value?.focus({ preventScroll: true })
  if (select !== null) {
    selected.value = select
    selectedDim.value = null
    // Clicking a surface selects it (and its panel); clicking the panel itself, just the panel
    selectedSurface.value = surface
  }
  e.currentTarget.setPointerCapture?.(e.pointerId)
  drag.value = { kind: 'pan', cx: e.clientX, cy: e.clientY, ox: view.ox, oy: view.oy, moved: false, deselect }
}

function straighten(i, edge) {
  setPanel(i, { [edge]: null })
  emit('commit')
}

function selectDim(e, id) {
  if (tool.value === 'measure') return startMeasure(e)
  e.stopPropagation()
  selectedDim.value = id
  selected.value = null
  selectedSurface.value = null
}

// --- Commands --------------------------------------------------------------------------

function addPanel() {
  emit('commit')
  own(() => (panels.value = appendPanel(panels.value, rootChord.value)))
  selected.value = panels.value.length - 1
}

function deletePanel() {
  if (selected.value === null || panels.value.length < 2) return
  emit('commit')
  own(() => (panels.value = removePanel(panels.value, selected.value)))
  selected.value = null
}

function insertAfterSelected() {
  if (selected.value === null) return
  emit('commit')
  const i = selected.value
  own(() => (panels.value = insertPanel(panels.value, i, rootChord.value)))
  selected.value = i + 1
}

function moveSelected(dir) {
  const i = selected.value
  if (i === null || i + dir < 0 || i + dir >= panels.value.length) return
  emit('commit')
  own(() => (panels.value = movePanel(panels.value, i, dir)))
  selected.value = i + dir
}

function newStation() {
  if (selected.value === null) return
  emit('commit')
  own(() => (panels.value = addStation(wingState(), selected.value)))
}

// A control surface on the selected panel, in its longest free stretch (controlSurfaces.js)
const surfaceToAdd = computed(() => (selected.value !== null && sampler.value && controls.value ? addSurface(sampler.value, controls.value.surfaces, selected.value) : null))
function newSurface() {
  const res = surfaceToAdd.value
  if (!res) return
  emit('commit')
  controls.value = { ...controls.value, surfaces: res.surfaces }
  selectedSurface.value = res.id
}

function deleteSurface() {
  if (selectedSurface.value === null || !controls.value) return
  emit('commit')
  controls.value = dropBay({ ...controls.value, surfaces: controls.value.surfaces.filter((x) => x.id !== selectedSurface.value) }, selectedSurface.value)
  selectedSurface.value = null
}

function deleteDim() {
  if (selectedDim.value === null) return
  emit('commit')
  dimensions.value = dimensions.value.filter((d) => d.id !== selectedDim.value)
  selectedDim.value = null
}

function clearDims() {
  emit('commit')
  dimensions.value = []
  selectedDim.value = null
}

function setTool(t) {
  tool.value = t
  hoverSnap.value = null
}

// --- Measure and the command bar ---------------------------------------------------------

// Measure is the one mode: a toggle top left (M), off again with Esc
const toggleMeasure = () => setTool(tool.value === 'measure' ? 'select' : 'measure')

// What the command bar acts on: the selected panel or dimension, (measuring) all the
// dimensions, or with nothing selected the wing itself (Add panel). Null hides it.
const cmd = computed(() => {
  if (tool.value === 'measure') return dimensions.value.length ? { kind: 'measure', label: 'Dimensions' } : null
  if (selectedDim.value !== null) return { kind: 'dim', label: 'Dimension' }
  if (selSurface.value) return { kind: 'surface', label: selSurface.value.label }
  if (selected.value !== null) return { kind: 'panel', label: `Panel ${selected.value + 1}` }
  return { kind: 'wing', label: '' }
})

// --- Keyboard --------------------------------------------------------------------------

function onKey(e) {
  // Ctrl+Z / Ctrl+Y are window-wide (WingCalc)
  if (e.ctrlKey || e.metaKey) return
  if (e.key === 'm' || e.key === 'M') {
    toggleMeasure()
  } else if (e.key === 'v' || e.key === 'V') {
    setTool('select')
  } else if (e.key === 'f' || e.key === 'F') {
    fit()
  } else if (e.key === '+' || e.key === '=') {
    zoomBy(1.25)
  } else if (e.key === '-' || e.key === '_') {
    zoomBy(1 / 1.25)
  } else if (e.key === 'Escape') {
    if (drag.value?.kind === 'measure') drag.value = null
    else if (tool.value === 'measure') setTool('select')
    else {
      selected.value = null
      selectedDim.value = null
      selectedSurface.value = null
    }
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    if (selectedDim.value !== null) deleteDim()
    else if (selSurface.value) deleteSurface()
    else if (selected.value !== null) deletePanel()
    else return
  } else if (selected.value !== null && e.key.startsWith('Arrow')) {
    // Arrows move the selected panel's outer leading edge by one grid step;
    // with Alt, up/down change its tip chord instead.
    const p = panels.value[selected.value]
    const st = step.value
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      setPanel(selected.value, { tipChord: Math.max(0, p.tipChord + (e.key === 'ArrowDown' ? st : -st)) })
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      setPanel(selected.value, { length: Math.max(st, p.length + (e.key === 'ArrowRight' ? st : -st)) })
    } else {
      setPanel(selected.value, { sweep: (p.sweep || 0) + (e.key === 'ArrowDown' ? st : -st) })
    }
  } else return
  e.preventDefault()
}

// --- Derived drawing data --------------------------------------------------------------

const pts = (list) => list.map(([s, x]) => `${s},${x}`).join(' ')

const shapes = computed(() =>
  plan.value.panels.map((p) => {
    const q = p.le.map(([s, x], k) => [s, x + (p.te[k][1] - x) / 4])
    const mode = panelMode(p.panel)
    const mid = (edge) => {
      const list = p[edge]
      return list.length ? list[Math.floor(list.length / 2)] : null
    }
    const ctrl = (edge) => {
      const c = p.panel[edge]
      if (!c || mode !== 'curves') return null
      const x0 = edge === 'le' ? p.inner.x : p.inner.x + p.inner.c
      const x1 = edge === 'le' ? p.outer.x : p.outer.x + p.outer.c
      const s = p.inner.s + (p.outer.s - p.inner.s) * c.u
      const onCurveK = Math.round(c.u * (p[edge].length - 1))
      return { s, x: x0 + (x1 - x0) * c.u + c.d, anchor: p[edge][onCurveK] }
    }
    // Usable stations sit on the outline; skipped ones are drawn where they'd be, in the
    // warning colour, using the straight line between the panel's ends.
    const checked = mode === 'stations' ? checkStations(p.panel) : { valid: [], ignored: [] }
    const ribs = p.edges
      ? checked.valid.map((st) => {
          const f = st.d / p.panel.length
          return { id: st.id, s: p.inner.s + st.d, xl: p.edges.le(f), xt: p.edges.te(f), chord: st.chord }
        })
      : []
    const ignoredRibs = checked.ignored
      .filter((ig) => Number.isFinite(ig.d))
      .map((ig) => {
        const f = ig.d / (p.panel.length || 1)
        const xl = p.inner.x + (p.outer.x - p.inner.x) * f
        const c = p.inner.c + (p.outer.c - p.inner.c) * Math.min(1, Math.max(0, f))
        return { id: ig.id, s: p.inner.s + ig.d, xl, xt: xl + c }
      })
    return {
      ...p,
      mode,
      polygonPts: pts(p.polygon),
      quarter: pts(q),
      midLe: mode === 'stations' ? null : mid('le'),
      midTe: mode === 'stations' ? null : mid('te'),
      ctrlLe: ctrl('le'),
      ctrlTe: ctrl('te'),
      ribs,
      ignoredRibs,
    }
  }),
)

const tipShape = computed(() => (plan.value.tip ? { ...plan.value.tip, polygonPts: pts(plan.value.tip.polygon) } : null))
const selShape = computed(() => (selected.value === null ? null : (shapes.value[selected.value] ?? null)))

// Diamond handle for the fuselage side, just ahead of the leading edge.
const fuseHandle = computed(() => {
  const r = px(HANDLE_PX * 1.3)
  const cy = -px(HANDLE_PX * 3)
  const cx = half.value
  return `${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`
})

// Dimensions resolved to current positions: attached ends follow their key point.
function resolveEnd(end) {
  const kp = end.ref ? pointMap.value.get(end.ref) : null
  return kp ? { s: kp.s, x: kp.x, attached: true } : { s: end.s, x: end.x, attached: false }
}

function dimGeometry(a, b, kind) {
  const ds = b.s - a.s
  const dx = b.x - a.x
  if (kind === 'span') {
    // Spanwise distance, drawn along the first point's chordwise position
    const y = a.x
    return { value: Math.abs(ds), line: [a.s, y, b.s, y], ext: [b.s, b.x, b.s, y], label: { s: (a.s + b.s) / 2, x: y - px(6) } }
  }
  if (kind === 'chord') {
    const xx = a.s
    return { value: Math.abs(dx), line: [xx, a.x, xx, b.x], ext: [b.s, b.x, xx, b.x], label: { s: xx + px(6), x: (a.x + b.x) / 2 } }
  }
  return {
    value: Math.hypot(ds, dx),
    line: [a.s, a.x, b.s, b.x],
    ext: null,
    label: { s: (a.s + b.s) / 2 + px(6), x: (a.x + b.x) / 2 - px(6) },
  }
}

const dims = computed(() =>
  dimensions.value.map((d) => {
    const a = resolveEnd(d.a)
    const b = resolveEnd(d.b)
    return { id: d.id, a, b, kind: d.kind, ...dimGeometry(a, b, d.kind) }
  }),
)

const liveDim = computed(() => {
  const d = drag.value
  if (d?.kind !== 'measure') return null
  const kind = d.shift ? (Math.abs(d.b.s - d.a.s) >= Math.abs(d.b.x - d.a.x) ? 'span' : 'chord') : 'aligned'
  return { a: d.a, b: d.b, kind, ...dimGeometry(d.a, d.b, kind) }
})

// Live readout for the handle being dragged, or the measurement in progress.
const readout = computed(() => {
  const d = drag.value
  if (d?.kind === 'measure') {
    const ds = d.b.s - d.a.s
    const dx = d.b.x - d.a.x
    const ang = (Math.atan2(dx, ds) * 180) / Math.PI
    return `Distance ${fmt(Math.hypot(ds, dx))} · span ${fmt(Math.abs(ds))} · chordwise ${fmt(Math.abs(dx))} · ${ang.toFixed(1)}°`
  }
  if (!d || d.kind === 'pan') return null
  if (d.kind === 'root') return `Root chord ${fmt(rootChord.value)}`
  if (d.kind === 'fuse') return `Fuselage width ${fmt(fuselageWidth.value)}`
  if (d.kind === 'tip') return `Tip extension ${fmt(tip.value?.extension)}, furthest at ${Math.round((tip.value?.peak ?? 0) * 100)}% chord`
  const p = panels.value[d.i]
  if (!p) return null
  if (d.kind === 'le') return `Panel ${d.i + 1}: length ${fmt(p.length)}, sweep ${fmt(p.sweep || 0)}`
  if (d.kind === 'te') return `Panel ${d.i + 1}: tip chord ${fmt(p.tipChord)}`
  if (d.kind === 'sle' || d.kind === 'ste') {
    const st = p.stations?.find((q) => q.id === d.station)
    return st ? `Station at ${fmt(st.d)}: chord ${fmt(st.chord)}, set-back ${fmt(st.le)}` : null
  }
  return `Panel ${d.i + 1}: curve offset ${fmt((p[d.kind === 'cle' ? 'le' : 'te'] ?? {}).d ?? 0)}`
})

const hint = computed(() => {
  if (tool.value === 'measure')
    return 'Measure: drag between two points. Ends snap to wing corners and stations (and follow them); Shift for a spanwise or chordwise dimension, Alt to ignore snapping. Esc to finish.'
  if (selectedDim.value !== null) return 'Dimension selected. Delete removes it.'
  if (selSurface.value) return `${selSurface.value.label} selected: hinge line dashed. Edit its numbers under Control surfaces; Delete removes it.`
  if (selected.value !== null) {
    const mode = selShape.value?.mode
    if (mode === 'stations') return `Panel ${selected.value + 1} selected. Drag a station's leading-edge handle to move it, its trailing-edge handle to change its chord.`
    return `Panel ${selected.value + 1} selected. Drag the round handles at its tip; drag the small ones on its edges to curve them.`
  }
  return 'Click a panel to select it. Drag to pan, scroll to zoom, F to fit. Alt disables snapping. M measures, V selects.'
})

// --- Lifecycle -------------------------------------------------------------------------

let ro = null
let fitted = false
function measure(w, h) {
  if (!w) return
  width.value = Math.round(w)
  if (props.fill && h) height.value = Math.max(200, Math.round(h))
  if (!fitted) {
    fit()
    fitted = true
  }
}
onMounted(() => {
  // Measure now so the first paint is right, then follow later size changes.
  measure(stageEl.value.clientWidth, stageEl.value.clientHeight)
  ro = new ResizeObserver(([entry]) => measure(entry.contentRect.width, entry.contentRect.height))
  ro.observe(stageEl.value)
  svgEl.value.addEventListener('wheel', onWheel, { passive: false })
})
onBeforeUnmount(() => {
  ro?.disconnect()
  svgEl.value?.removeEventListener('wheel', onWheel)
  clearTimeout(fitTimer)
})

// Re-frame after the wing changes from outside this editor. Debounced so typing a value
// settles before the view moves.
let fitTimer = null
watch(
  () => JSON.stringify(wingState()),
  () => {
    if (ownEdit) return
    clearTimeout(fitTimer)
    fitTimer = setTimeout(fit, 250)
  },
)

// Drop the surface selection when that surface goes (deleted elsewhere, or undone)
watch(
  () => controls.value?.surfaces.map((x) => x.id).join(','),
  () => {
    if (selectedSurface.value !== null && !controls.value?.surfaces.some((x) => x.id === selectedSurface.value)) selectedSurface.value = null
  },
)

// Keep the selection valid when panels are removed elsewhere.
watch(
  () => panels.value.length,
  (n) => {
    if (selected.value !== null && selected.value >= n) selected.value = null
  },
)
</script>

<template>
  <div class="wc-plan" :class="{ 'wc-plan--fill': fill }">
    <div
      ref="wrapEl"
      class="wc-plan__canvas"
      tabindex="0"
      aria-label="Wing plan editor. Arrow keys move the selected panel's tip; Delete removes the selection; M measures, V selects, F fits."
      @keydown="onKey"
    >
      <div ref="stageEl" class="wc-plan__stage">
        <svg
          ref="svgEl"
          :viewBox="viewBox"
          :width="width"
          :height="height"
          class="wc-plan__svg"
          :class="{ 'wc-plan__svg--panning': drag?.kind === 'pan', 'wc-plan__svg--measure': tool === 'measure' }"
          @pointerdown.self="startPan($event, { deselect: true })"
          @pointermove="moveHandle"
          @pointerup="endHandle"
          @pointercancel="endHandle"
          @pointerleave="hoverSnap = drag ? hoverSnap : null"
        >
          <!-- Grid -->
          <g class="wc-plan__grid" pointer-events="none">
            <template v-for="(l, k) in grid.lines" :key="k">
              <line
                v-if="l.v"
                :x1="l.p"
                :x2="l.p"
                :y1="grid.y0"
                :y2="grid.y1"
                :class="l.major ? 'wc-plan__major' : 'wc-plan__minor'"
              />
              <line v-else :x1="grid.x0" :x2="grid.x1" :y1="l.p" :y2="l.p" :class="l.major ? 'wc-plan__major' : 'wc-plan__minor'" />
            </template>
            <line x1="0" x2="0" :y1="grid.y0" :y2="grid.y1" class="wc-plan__centre" />
          </g>

          <!-- Left half, mirrored for context -->
          <g transform="scale(-1,1)" class="wc-plan__ghost" pointer-events="none">
            <rect v-if="half > 0" x="0" y="0" :width="half" :height="rootChord" />
            <polygon v-for="p in shapes" :key="'g' + p.index" :points="p.polygonPts" />
            <polygon v-if="tipShape" :points="tipShape.polygonPts" />
          </g>

          <!-- Fuselage section -->
          <rect
            v-if="half > 0"
            x="0"
            y="0"
            :width="half"
            :height="rootChord"
            class="wc-plan__fuselage"
            @pointerdown="startPan($event, { deselect: true })"
          />

          <!-- Panels and tip -->
          <polygon
            v-for="p in shapes"
            :key="'p' + p.panel.id"
            :points="p.polygonPts"
            class="wc-plan__panel"
            :class="{ 'wc-plan__panel--selected': selected === p.index }"
            @pointerdown="startPan($event, { select: p.index })"
          />
          <polygon
            v-if="tipShape"
            :points="tipShape.polygonPts"
            class="wc-plan__panel wc-plan__panel--tip"
            @pointerdown="startPan($event, { deselect: true })"
          />
          <polyline v-for="p in shapes" :key="'q' + p.panel.id" :points="p.quarter" class="wc-plan__quarter" pointer-events="none" />

          <!-- Control surfaces, from the hinge line (dashed) to the trailing edge -->
          <g v-for="r in surfaces" :key="'cs' + r.id">
            <polygon
              :points="r.outline"
              class="wc-plan__surface"
              :class="{ 'wc-plan__surface--selected': selectedSurface === r.id, 'wc-plan__surface--bad': r.problem === 'overlap' }"
              @pointerdown.stop="startPan($event, { select: r.panelIndex, surface: r.id })"
            >
              <title>{{ r.label }}{{ r.problem === 'overlap' ? ': overlaps another surface, so it isn’t used' : '' }}</title>
            </polygon>
            <line :x1="r.hinge[0]" :y1="r.hinge[1]" :x2="r.hinge[2]" :y2="r.hinge[3]" class="wc-plan__hinge" pointer-events="none" />
          </g>

          <!-- Chord station ribs -->
          <g pointer-events="none">
            <template v-for="p in shapes" :key="'r' + p.panel.id">
              <line v-for="r in p.ribs" :key="r.id" :x1="r.s" :y1="r.xl" :x2="r.s" :y2="r.xt" class="wc-plan__rib" />
              <line
                v-for="r in p.ignoredRibs"
                :key="'x' + r.id"
                :x1="r.s"
                :y1="r.xl"
                :x2="r.s"
                :y2="r.xt"
                class="wc-plan__rib wc-plan__rib--ignored"
              />
            </template>
          </g>

          <!-- Curve control lines for the selected panel -->
          <g v-if="selShape" pointer-events="none" class="wc-plan__ctrl-lines">
            <line
              v-if="selShape.ctrlLe"
              :x1="selShape.ctrlLe.s"
              :y1="selShape.ctrlLe.x"
              :x2="selShape.ctrlLe.anchor[0]"
              :y2="selShape.ctrlLe.anchor[1]"
            />
            <line
              v-if="selShape.ctrlTe"
              :x1="selShape.ctrlTe.s"
              :y1="selShape.ctrlTe.x"
              :x2="selShape.ctrlTe.anchor[0]"
              :y2="selShape.ctrlTe.anchor[1]"
            />
          </g>

          <!-- Dimensions -->
          <g class="wc-plan__dimset" :font-size="px(11)">
            <g
              v-for="d in dims"
              :key="'d' + d.id"
              class="wc-plan__dimension"
              :class="{ 'wc-plan__dimension--selected': selectedDim === d.id }"
              @pointerdown="selectDim($event, d.id)"
            >
              <line v-if="d.ext" :x1="d.ext[0]" :y1="d.ext[1]" :x2="d.ext[2]" :y2="d.ext[3]" class="wc-plan__dim-ext" />
              <line :x1="d.line[0]" :y1="d.line[1]" :x2="d.line[2]" :y2="d.line[3]" class="wc-plan__dim-hit" />
              <line :x1="d.line[0]" :y1="d.line[1]" :x2="d.line[2]" :y2="d.line[3]" class="wc-plan__dim-line" />
              <circle :cx="d.line[0]" :cy="d.line[1]" :r="px(2.5)" :class="d.a.attached ? 'wc-plan__dim-end--attached' : 'wc-plan__dim-end'" />
              <circle :cx="d.line[2]" :cy="d.line[3]" :r="px(2.5)" :class="d.b.attached ? 'wc-plan__dim-end--attached' : 'wc-plan__dim-end'" />
              <text :x="d.label.s" :y="d.label.x" class="wc-plan__dim-text">{{ fmt(d.value) }}</text>
            </g>
            <g v-if="liveDim" class="wc-plan__dimension wc-plan__dimension--live" pointer-events="none">
              <line v-if="liveDim.ext" :x1="liveDim.ext[0]" :y1="liveDim.ext[1]" :x2="liveDim.ext[2]" :y2="liveDim.ext[3]" class="wc-plan__dim-ext" />
              <line :x1="liveDim.line[0]" :y1="liveDim.line[1]" :x2="liveDim.line[2]" :y2="liveDim.line[3]" class="wc-plan__dim-line" />
              <text :x="liveDim.label.s" :y="liveDim.label.x" class="wc-plan__dim-text">{{ fmt(liveDim.value) }}</text>
            </g>
          </g>

          <!-- Handles (select tool) -->
          <g v-if="tool === 'select'" class="wc-plan__handles">
            <polygon :points="fuseHandle" class="wc-plan__handle wc-plan__handle--fuse" @pointerdown="startHandle($event, 'fuse')">
              <title>Fuselage width: drag sideways</title>
            </polygon>
            <circle :cx="half" :cy="rootChord" :r="px(HANDLE_PX)" class="wc-plan__handle" @pointerdown="startHandle($event, 'root')">
              <title>Root chord: drag up or down</title>
            </circle>
            <template v-for="p in shapes" :key="'h' + p.panel.id">
              <circle
                :cx="p.outer.s"
                :cy="p.outer.x"
                :r="px(HANDLE_PX)"
                class="wc-plan__handle"
                @pointerdown="startHandle($event, 'le', p.index)"
              >
                <title>Panel {{ p.index + 1 }} tip leading edge: drag for length and sweep (Shift keeps sweep)</title>
              </circle>
              <circle
                :cx="p.outer.s"
                :cy="p.outer.x + p.outer.c"
                :r="px(HANDLE_PX)"
                class="wc-plan__handle"
                @pointerdown="startHandle($event, 'te', p.index)"
              >
                <title>Panel {{ p.index + 1 }} tip chord: drag up or down</title>
              </circle>
            </template>
            <circle
              v-if="tipShape"
              :cx="tipShape.peak.s"
              :cy="tipShape.peak.x"
              :r="px(HANDLE_PX)"
              class="wc-plan__handle wc-plan__handle--curve"
              @pointerdown="startHandle($event, 'tip')"
            >
              <title>Wingtip: drag out for extension, along the chord for where it reaches furthest</title>
            </circle>
            <!-- Station handles on the selected panel -->
            <template v-if="selShape?.mode === 'stations'">
              <template v-for="r in selShape.ribs" :key="'sh' + r.id">
                <circle
                  :cx="r.s"
                  :cy="r.xl"
                  :r="px(HANDLE_PX * 0.85)"
                  class="wc-plan__handle wc-plan__handle--station"
                  @pointerdown="startHandle($event, 'sle', selShape.index, { station: r.id })"
                >
                  <title>Station: drag to move it along the panel and set its leading edge</title>
                </circle>
                <circle
                  :cx="r.s"
                  :cy="r.xt"
                  :r="px(HANDLE_PX * 0.85)"
                  class="wc-plan__handle wc-plan__handle--station"
                  @pointerdown="startHandle($event, 'ste', selShape.index, { station: r.id })"
                >
                  <title>Station chord: drag up or down</title>
                </circle>
              </template>
            </template>
            <!-- Curve handles on the selected panel -->
            <template v-if="selShape && selShape.mode !== 'stations'">
              <template v-for="edge in ['le', 'te']" :key="edge">
                <rect
                  v-if="selShape[edge === 'le' ? 'ctrlLe' : 'ctrlTe']"
                  :x="selShape[edge === 'le' ? 'ctrlLe' : 'ctrlTe'].s - px(HANDLE_PX * 0.85)"
                  :y="selShape[edge === 'le' ? 'ctrlLe' : 'ctrlTe'].x - px(HANDLE_PX * 0.85)"
                  :width="px(HANDLE_PX * 1.7)"
                  :height="px(HANDLE_PX * 1.7)"
                  class="wc-plan__handle wc-plan__handle--curve"
                  @pointerdown="startHandle($event, edge === 'le' ? 'cle' : 'cte', selShape.index)"
                  @dblclick="straighten(selShape.index, edge)"
                >
                  <title>Curve handle: drag to shape the edge, double-click to straighten</title>
                </rect>
                <circle
                  v-else-if="selShape[edge === 'le' ? 'midLe' : 'midTe']"
                  :cx="selShape[edge === 'le' ? 'midLe' : 'midTe'][0]"
                  :cy="selShape[edge === 'le' ? 'midLe' : 'midTe'][1]"
                  :r="px(HANDLE_PX * 0.8)"
                  class="wc-plan__handle wc-plan__handle--add"
                  @pointerdown="startHandle($event, edge === 'le' ? 'mle' : 'mte', selShape.index)"
                >
                  <title>Drag to curve this edge</title>
                </circle>
              </template>
            </template>
          </g>

          <!-- Snap target in measure mode -->
          <circle
            v-if="tool === 'measure' && hoverSnap"
            :cx="hoverSnap.s"
            :cy="hoverSnap.x"
            :r="px(SNAP_PX * 0.8)"
            class="wc-plan__snap"
            pointer-events="none"
          />

          <!-- Dimensions for the selected panel -->
          <g v-if="selShape && tool === 'select'" class="wc-plan__dims" pointer-events="none" :font-size="px(11)">
            <text :x="(selShape.inner.s + selShape.outer.s) / 2" :y="Math.min(selShape.inner.x, selShape.outer.x) - px(10)" text-anchor="middle">
              {{ fmt(selShape.panel.length) }}
            </text>
            <text :x="selShape.outer.s + px(10)" :y="selShape.outer.x + selShape.outer.c / 2" dominant-baseline="middle">
              {{ fmt(selShape.outer.c) }}
            </text>
            <text
              v-for="r in selShape.ribs"
              :key="'rl' + r.id"
              :x="r.s + px(4)"
              :y="(r.xl + r.xt) / 2"
              dominant-baseline="middle"
              class="wc-plan__rib-label"
            >
              {{ fmt(r.chord) }}
            </text>
          </g>
        </svg>
        <div class="wc-stage__corner wc-stage__corner--tl" role="toolbar" aria-label="Tools">
          <button
            type="button"
            class="wc-button wc-stage__btn wc-stage__snap"
            :aria-pressed="String(tool === 'measure')"
            title="Measure and dimension (M): click two points. Esc stops."
            @click="toggleMeasure"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><path v-for="(d, k) in MEASURE" :key="k" :d="d" /></svg>
            Measure
          </button>
        </div>
        <div v-if="cmd" class="wc-cmd" role="toolbar" :aria-label="cmd.label || 'Wing'">
          <span v-if="cmd.label" class="wc-cmd__label">{{ cmd.label }}</span>
          <template v-if="cmd.kind === 'panel'">
            <button type="button" class="wc-cmd__btn" title="Insert a new panel outboard of this one" @click="insertAfterSelected">Insert after</button>
            <button type="button" class="wc-cmd__btn" :disabled="selected === 0" title="Move this panel inward" aria-label="Move panel inward" @click="moveSelected(-1)">←</button>
            <button type="button" class="wc-cmd__btn" :disabled="selected === panels.length - 1" title="Move this panel outward" aria-label="Move panel outward" @click="moveSelected(1)">→</button>
            <button v-if="selShape?.mode === 'stations'" type="button" class="wc-cmd__btn" @click="newStation">Add station</button>
            <button
              v-if="controls"
              type="button"
              class="wc-cmd__btn"
              :disabled="!surfaceToAdd"
              :title="surfaceToAdd ? 'Add an aileron or flap to this panel, in its longest free stretch' : 'No room left on this panel'"
              @click="newSurface"
            >
              Add control surface
            </button>
            <span class="wc-cmd__sep" />
            <button type="button" class="wc-cmd__btn" :disabled="panels.length < 2" title="Delete this panel (Delete)" @click="deletePanel">Delete</button>
          </template>
          <button v-else-if="cmd.kind === 'dim'" type="button" class="wc-cmd__btn" title="Delete this dimension (Delete)" @click="deleteDim">Delete</button>
          <button v-else-if="cmd.kind === 'surface'" type="button" class="wc-cmd__btn" title="Delete this control surface (Delete)" @click="deleteSurface">Delete</button>
          <button v-else-if="cmd.kind === 'measure'" type="button" class="wc-cmd__btn" @click="clearDims">Clear dimensions</button>
          <button v-else-if="cmd.kind === 'wing'" type="button" class="wc-cmd__btn" title="Add a panel at the tip" @click="addPanel">Add panel</button>
        </div>
        <StageZoom v-model:snap="snapOn" :snap-step="fmt(step)" fit-title="Fit the wing to the view (F)" @zoom-in="zoomBy(1.25)" @zoom-out="zoomBy(1 / 1.25)" @fit="fit" />
      </div>
      <p class="wc-plan__readout" aria-live="polite">{{ readout ?? hint }}</p>
    </div>
  </div>
</template>
