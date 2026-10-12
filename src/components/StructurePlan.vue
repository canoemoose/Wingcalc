<script setup>
// The half wing seen from above, flat as built, with its structure: leading and trailing
// edge stock, the spar, stringers and every rib. Bays where a margin falls below zero are
// shaded. Click a rib to select it.
//
// It navigates like the wing plan editor: scroll to zoom about the pointer, drag empty space
// to pan, Fit to frame the wing, with a grid that adapts to the zoom. With manual rib
// spacing it edits like it too: drag a rib along the span (it snaps to the grid, measured
// from the root rib; Alt to place freely), double-click the wing to add one, Delete removes
// the selected one, and the arrow keys nudge it a grid step (Shift for ten). Manual ribs and
// hard points move; the root, panel-break and tip ribs are fixed.
import { computed, ref, reactive, watch, onMounted, onBeforeUnmount, useId } from 'vue'
import { flatPanels } from '../lib/wing.js'
import { MODES, SPACING_MODES, sheetOutline } from '../lib/structure.js'
import { format, defaultUnit } from '../lib/units.js'

const props = defineProps({
  analysis: { type: Object, required: true },
  parts: { type: Array, required: true },
  selected: { type: String, default: null },
  system: { type: String, default: 'metric' },
  // Manual spacing: ribs can be moved, added and removed here
  editable: { type: Boolean, default: false },
})
const emit = defineEmits(['select', 'commit'])
const structure = defineModel('structure', { type: Object, required: true })

const a = computed(() => props.analysis)
const flat = computed(() => flatPanels(a.value.wing))
const ribs = computed(() => props.parts.filter((p) => p.group === 'ribs'))
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
  return {
    le: line((s) => sec(s).xl + st.le.width),
    te: line((s) => sec(s).xl + sec(s).c - st.te.width),
    spar: band.map(([x, y]) => `${x.toFixed(5)},${y.toFixed(5)}`).join(' '),
    stringers: (st.stringers ?? []).filter((x) => Number.isFinite(x.position)).map((x) => line((s) => sec(s).xl + x.position * sec(s).c)),
    sheet,
  }
})

// Ribs that can be moved here: manual ribs and hard points, in manual mode
const movable = (p) => props.editable && (p.kind === 'manual' || p.kind === 'hard') && p.sourceId != null

// Each rib as a line in plan, from the LE stock to the TE stock
const ribLines = computed(() =>
  ribs.value.map((p) => {
    const r = p.rib
    const ang = (r.angle * Math.PI) / 180
    const d = [Math.sin(ang), Math.cos(ang)]
    const P = [p.s, a.value.sparX(p.s)]
    const at = (u) => [P[0] + d[0] * (u - r.sparU), P[1] + d[1] * (u - r.sparU)]
    const [x1, y1] = at(r.uA)
    const [x2, y2] = at(r.uB)
    return { id: p.id, name: p.name, kind: p.kind, x1, y1, x2, y2, movable: movable(p) }
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
  remeasure = measure
})
let remeasure = () => {}
onBeforeUnmount(() => {
  sizeObs?.disconnect()
  window.removeEventListener('resize', remeasure)
})
const vb = computed(() => {
  const f = fit.value
  // Fit the wing inside the element's proportions, then zoom
  const aspect = el.w / el.h
  const fw = f.w / f.h > aspect ? f.w : f.h * aspect
  const fh = fw / aspect
  const w = fw / zoom.k
  const h = fh / zoom.k
  const cx = zoom.cx ?? f.x + f.w / 2
  const cy = zoom.cy ?? f.y + f.h / 2
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

function onWheel(e) {
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
  const list = STEPS[props.system] ?? STEPS.metric
  return list.find((s) => s * pxPerMetre() >= 8) ?? list.at(-1)
})
const snapOn = ref(true)
const grid = computed(() => {
  const v = vb.value
  const s = step.value
  const major = props.system === 'imperial' ? 4 : 5
  const s0 = a.value.rootS // spanwise lines measured from the root rib
  const lines = []
  for (let i = Math.ceil((v.x - s0) / s); s0 + i * s <= v.x + v.w; i++) lines.push({ v: true, p: s0 + i * s, major: i % major === 0 })
  for (let i = Math.ceil(v.y / s); i * s <= v.y + v.h; i++) lines.push({ v: false, p: i * s, major: i % major === 0 })
  return lines.length < 600 ? lines : []
})
const snap = (d, e) => (snapOn.value && !e?.altKey ? Math.round(d / step.value) * step.value : d)

// --- Editing ---------------------------------------------------------------------------------

const partFor = (id) => ribs.value.find((p) => p.id === id)
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
// Add rib: in the middle of the widest bay
function addInWidest() {
  const list = ribs.value
  let best = null
  for (let i = 1; i < list.length; i++) {
    const w = list[i].s - list[i - 1].s
    if (!best || w > best.w) best = { w, s: (list[i].s + list[i - 1].s) / 2 }
  }
  if (best) addAt(snap(best.s - a.value.rootS))
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
  if (!line.movable) return
  e.stopPropagation()
  svgEl.value.setPointerCapture(e.pointerId)
  const p = partFor(line.id)
  drag.value = { part: p, d: p.s - a.value.rootS, moved: false, startX: e.clientX, startY: e.clientY }
}
function onBackgroundDown(e) {
  svgEl.value.setPointerCapture(e.pointerId)
  const v = vb.value
  pan.value = { x: e.clientX, y: e.clientY, cx: v.x + v.w / 2, cy: v.y + v.h / 2 }
}
function onMove(e) {
  if (drag.value) {
    const dr = drag.value
    if (Math.hypot(e.clientX - dr.startX, e.clientY - dr.startY) > 3) dr.moved = true
    if (dr.moved) dr.d = clampD(snap(toWorld(e).s - a.value.rootS, e))
  } else if (pan.value) {
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
const KINDS = { root: 'Root rib', break: 'Panel break', tip: 'Tip rib', hard: 'Hard point', manual: 'Manual rib', normal: 'Rib' }
const readout = computed(() => {
  const p = selectedPart.value
  if (!p) return null
  const list = ribs.value
  const s = preview.value ? preview.value.s : p.s
  const i = list.indexOf(p)
  const before = i > 0 ? s - list[i - 1].s : null
  const after = i < list.length - 1 ? list[i + 1].s - s : null
  const hp = p.kind === 'hard' ? (structure.value.ribs.hardPoints ?? []).find((h) => h.id === p.sourceId) : null
  return {
    name: p.name,
    kind: hp?.label ? `${KINDS.hard}: ${hp.label}` : KINDS[p.kind] ?? 'Rib',
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
    <div class="wc-plan__toolbar" role="toolbar" aria-label="Structure plan tools">
      <template v-if="editable">
        <button type="button" class="wc-button" @click="addInWidest">Add rib</button>
        <button type="button" class="wc-button" :disabled="!readout?.movable" @click="removeSelected">Delete rib</button>
        <span class="wc-plan__sep" />
      </template>
      <label class="wc-check"><input v-model="snapOn" type="checkbox" /> Snap to grid ({{ fmt(step) }})</label>
      <span class="wc-plan__spacer" />
      <button type="button" class="wc-button" @click="fitView">Fit</button>
    </div>
    <svg
      ref="svgEl"
      :viewBox="`${vb.x} ${vb.y} ${vb.w} ${vb.h}`"
      preserveAspectRatio="xMidYMid meet"
      class="wc-structure-plan__svg"
      :class="{ 'wc-structure-plan__svg--panning': pan }"
      tabindex="0"
      role="img"
      aria-label="Wing structure seen from above, one side"
      @wheel.prevent="onWheel"
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
          <line x1="0" y1="0" x2="0" :y2="hatch.step" :stroke-width="hatch.width" class="wc-sp__hatch" />
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
        <template v-if="geom.sheet">
          <polygon :points="geom.sheet" class="wc-sp__sheet" />
          <polygon :points="geom.sheet" class="wc-sp__sheet-hatch" :fill="`url(#${hatchId})`" />
        </template>
        <polyline :points="geom.le" class="wc-sp__stock" />
        <polyline :points="geom.te" class="wc-sp__stock" />
        <polyline v-for="(s, i) in geom.stringers" :key="'s' + i" :points="s" class="wc-sp__stringer" />
        <polygon :points="geom.spar" class="wc-sp__spar" />
      </g>
      <g
        v-for="(r, i) in ribLines"
        :key="r.id"
        class="wc-sp__rib"
        :class="{
          'wc-sp__rib--selected': r.id === selected,
          'wc-sp__rib--hard': r.kind !== 'normal' && r.kind !== 'manual',
          'wc-sp__rib--movable': r.movable,
          'wc-sp__rib--dragging': drag?.moved && drag.part.id === r.id,
        }"
      >
        <line :x1="r.x1" :y1="r.y1" :x2="r.x2" :y2="r.y2" class="wc-sp__ribline" />
        <line :x1="r.x1" :y1="r.y1" :x2="r.x2" :y2="r.y2" class="wc-sp__ribhit" @pointerdown.stop="onRibDown($event, r)">
          <title>{{ r.name }}{{ r.movable ? ': drag to move' : '' }}</title>
        </line>
        <text
          v-if="i % labelEvery === 0 || r.id === selected"
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
    <p v-if="readout" class="wc-plan__readout wc-structure-plan__readout">
      <strong>{{ readout.name }}</strong> {{ readout.kind }}, {{ readout.d }} from the root rib<template v-if="readout.bays"
        >; bays {{ readout.bays }}</template
      >.
      <template v-if="readout.movable"> Drag it, or nudge with the arrow keys; Delete removes it.</template>
    </p>
    <figcaption class="wc-figure__caption">
      One side, flat as built, leading edge at the top. Spar in accent colour<template v-if="geom.sheet">,
        sheeted area hatched</template
      ><template v-if="weakKinds.has('strength')">; red bays are short of strength in the spar, web or sheeting, which
        closer ribs won't fix (see the warnings)</template
      ><template v-if="weakKinds.has('spacing')">; amber bays have ribs too far apart</template>. Scroll to zoom, drag to
      move around.
      <template v-if="editable">Double-click the wing to add a rib.</template>
      <template v-else>Click a rib to see it; set spacing to Manual to move ribs here.</template>
    </figcaption>
  </figure>
</template>
