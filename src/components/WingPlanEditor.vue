<script setup>
// CAD-style plan editor for the half wing, drawn flat (as built). Drag the handles to change
// root chord, fuselage width, each panel's length, sweep and tip chord, and the shape of
// curved edges. Numeric entry for the same values lives in PanelEditor.
import { ref, reactive, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { flatPanels, appendPanel, removePanel } from '../lib/wing.js'
import { format, defaultUnit } from '../lib/units.js'

const props = defineProps({
  system: { type: String, required: true },
  canUndo: { type: Boolean, default: false },
  canRedo: { type: Boolean, default: false },
})
const emit = defineEmits(['undo', 'redo', 'commit'])
const rootChord = defineModel('rootChord', { type: Number, default: null })
const fuselageWidth = defineModel('fuselageWidth', { type: Number, default: 0 })
const panels = defineModel('panels', { type: Array, required: true })
const selected = defineModel('selected', { type: Number, default: null })

const HEIGHT = 340
const HANDLE_PX = 6
const wrapEl = ref(null)
const svgEl = ref(null)
const width = ref(600)
const view = reactive({ ox: -0.05, oy: -0.1, scale: 400 }) // world origin of the top-left, px per metre
const snapOn = ref(true)
const drag = ref(null)
const hover = ref(null)

const lengthUnit = computed(() => defaultUnit(props.system, 'length'))
const fmt = (v) => format(v, 'length', lengthUnit.value)

const plan = computed(() =>
  flatPanels({ fuselageWidth: fuselageWidth.value, rootChord: rootChord.value, panels: panels.value }),
)
const half = computed(() => Math.max(0, fuselageWidth.value || 0) / 2)

const viewBox = computed(() => `${view.ox} ${view.oy} ${width.value / view.scale} ${HEIGHT / view.scale}`)
const px = (n) => n / view.scale // screen pixels to world metres

// Grid step (and snap increment): the smallest "nice" step in the current unit system at
// least 8 px apart, so snapping stays fine enough for real dimensions at any zoom.
const STEPS = {
  metric: [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1],
  imperial: [1 / 16, 1 / 8, 1 / 4, 1 / 2, 1, 2, 6, 12, 24].map((i) => i * 0.0254),
}
const step = computed(() => STEPS[props.system].find((s) => s * view.scale >= 8) ?? STEPS[props.system].at(-1))
const majorEvery = computed(() => (props.system === 'metric' ? 5 : 4))

const grid = computed(() => {
  const s = step.value
  const x0 = view.ox
  const y0 = view.oy
  const x1 = x0 + width.value / view.scale
  const y1 = y0 + HEIGHT / view.scale
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
  for (const p of plan.value) {
    for (const [s, x] of p.polygon) {
      sMax = Math.max(sMax, s)
      xMin = Math.min(xMin, x)
      xMax = Math.max(xMax, x)
    }
  }
  return { sMin: -0.08 * sMax, sMax, xMin, xMax }
}

function fit() {
  const b = bounds()
  const w = b.sMax - b.sMin
  const h = b.xMax - b.xMin
  const scale = Math.min((width.value * 0.88) / w, (HEIGHT * 0.7) / h)
  view.scale = scale
  view.ox = b.sMin - (width.value / scale - w) / 2
  view.oy = b.xMin - (HEIGHT / scale - h) / 2
}

function zoomAt(factor, sx, sy) {
  const wx = view.ox + sx / view.scale
  const wy = view.oy + sy / view.scale
  view.scale = Math.min(20000, Math.max(20, view.scale * factor))
  view.ox = wx - sx / view.scale
  view.oy = wy - sy / view.scale
}

function onWheel(e) {
  e.preventDefault()
  const r = svgEl.value.getBoundingClientRect()
  zoomAt(Math.exp(-e.deltaY * 0.0015), ((e.clientX - r.left) / r.width) * width.value, ((e.clientY - r.top) / r.height) * HEIGHT)
}

// --- Pointer handling ----------------------------------------------------------------

// Pointer position in world metres. Maps through the rendered size rather than the width
// we last measured, so it stays right even if a resize hasn't been observed yet.
function world(e) {
  const r = svgEl.value.getBoundingClientRect()
  const vw = width.value / view.scale
  const vh = HEIGHT / view.scale
  return { s: view.ox + ((e.clientX - r.left) / r.width) * vw, x: view.oy + ((e.clientY - r.top) / r.height) * vh }
}

function setPanel(i, patch) {
  panels.value = panels.value.map((p, j) => (j === i ? { ...p, ...patch } : p))
}

function startHandle(e, kind, i = null) {
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
  drag.value = { kind, i, startPanel: i !== null ? { ...panels.value[i] } : null }
}

function moveHandle(e) {
  const d = drag.value
  if (!d) return
  const w = world(e)
  if (d.kind === 'pan') {
    const r = svgEl.value.getBoundingClientRect()
    view.ox = d.ox - ((e.clientX - d.cx) / r.width) * (width.value / view.scale)
    view.oy = d.oy - ((e.clientY - d.cy) / r.height) * (HEIGHT / view.scale)
    d.moved ||= Math.hypot(e.clientX - d.cx, e.clientY - d.cy) > 3
    return
  }
  if (d.kind === 'root') {
    rootChord.value = Math.max(0.02, snap(w.x, e))
    return
  }
  if (d.kind === 'fuse') {
    fuselageWidth.value = Math.min(0.5, Math.max(0, snap(w.s, e) * 2))
    return
  }
  const p = plan.value[d.i]
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
  }
}

function endHandle() {
  const d = drag.value
  if (d?.kind === 'pan' && !d.moved && d.deselect) selected.value = null
  drag.value = null
  // Each completed drag is its own undo step.
  if (d && d.kind !== 'pan') emit('commit')
}

function startPan(e, { deselect = false, select = null } = {}) {
  if (e.button !== 0 && e.button !== 1) return
  wrapEl.value?.focus({ preventScroll: true })
  if (select !== null) selected.value = select
  e.currentTarget.setPointerCapture?.(e.pointerId)
  drag.value = { kind: 'pan', cx: e.clientX, cy: e.clientY, ox: view.ox, oy: view.oy, moved: false, deselect }
}

function straighten(i, edge) {
  setPanel(i, { [edge]: null })
}

// --- Keyboard --------------------------------------------------------------------------

function onKey(e) {
  const mod = e.ctrlKey || e.metaKey
  if (mod && (e.key === 'z' || e.key === 'Z')) {
    emit(e.shiftKey ? 'redo' : 'undo')
  } else if (mod && (e.key === 'y' || e.key === 'Y')) {
    emit('redo')
  } else if (e.key === 'Escape') {
    selected.value = null
  } else if ((e.key === 'Delete' || e.key === 'Backspace') && selected.value !== null) {
    deletePanel()
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

function addPanel() {
  emit('commit')
  panels.value = appendPanel(panels.value, rootChord.value)
  selected.value = panels.value.length - 1
}

function deletePanel() {
  if (selected.value === null || panels.value.length < 2) return
  emit('commit')
  panels.value = removePanel(panels.value, selected.value)
  selected.value = null
}

// --- Derived drawing data --------------------------------------------------------------

const pts = (list) => list.map(([s, x]) => `${s},${x}`).join(' ')

const shapes = computed(() =>
  plan.value.map((p) => {
    const q = p.le.map(([s, x], k) => [s, x + (p.te[k][1] - x) / 4])
    const mid = (edge) => {
      const list = p[edge]
      return list.length ? list[Math.floor(list.length / 2)] : null
    }
    const ctrl = (edge) => {
      const c = p.panel[edge]
      if (!c) return null
      const x0 = edge === 'le' ? p.inner.x : p.inner.x + p.inner.c
      const x1 = edge === 'le' ? p.outer.x : p.outer.x + p.outer.c
      const s = p.inner.s + (p.outer.s - p.inner.s) * c.u
      const onCurveK = Math.round(c.u * (p[edge].length - 1))
      return { s, x: x0 + (x1 - x0) * c.u + c.d, anchor: p[edge][onCurveK] }
    }
    return {
      ...p,
      polygonPts: pts(p.polygon),
      quarter: pts(q),
      midLe: mid('le'),
      midTe: mid('te'),
      ctrlLe: ctrl('le'),
      ctrlTe: ctrl('te'),
    }
  }),
)

// Diamond handle for the fuselage side, just ahead of the leading edge.
const fuseHandle = computed(() => {
  const r = px(HANDLE_PX * 1.3)
  const cy = -px(HANDLE_PX * 3)
  const cx = half.value
  return `${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`
})

const selShape = computed(() => (selected.value === null ? null : (shapes.value[selected.value] ?? null)))

// Live readout for the handle being dragged.
const readout = computed(() => {
  const d = drag.value
  if (!d || d.kind === 'pan') return null
  if (d.kind === 'root') return `Root chord ${fmt(rootChord.value)}`
  if (d.kind === 'fuse') return `Fuselage width ${fmt(fuselageWidth.value)}`
  const p = panels.value[d.i]
  if (!p) return null
  if (d.kind === 'le') return `Panel ${d.i + 1}: length ${fmt(p.length)}, sweep ${fmt(p.sweep || 0)}`
  if (d.kind === 'te') return `Panel ${d.i + 1}: tip chord ${fmt(p.tipChord)}`
  return `Panel ${d.i + 1}: curve offset ${fmt((p[d.kind === 'cle' ? 'le' : 'te'] ?? {}).d ?? 0)}`
})

// --- Lifecycle -------------------------------------------------------------------------

let ro = null
let fitted = false
function measure(w) {
  if (!w) return
  width.value = Math.round(w)
  if (!fitted) {
    fit()
    fitted = true
  }
}
onMounted(() => {
  // Measure now so the first paint is right, then follow later size changes.
  measure(wrapEl.value.clientWidth)
  ro = new ResizeObserver(([entry]) => measure(entry.contentRect.width))
  ro.observe(wrapEl.value)
  svgEl.value.addEventListener('wheel', onWheel, { passive: false })
})
onBeforeUnmount(() => {
  ro?.disconnect()
  svgEl.value?.removeEventListener('wheel', onWheel)
})

// Keep the selection valid when panels are removed elsewhere.
watch(
  () => panels.value.length,
  (n) => {
    if (selected.value !== null && selected.value >= n) selected.value = null
  },
)
</script>

<template>
  <div class="wc-plan">
    <div class="wc-plan__toolbar" role="toolbar" aria-label="Wing plan tools">
      <button type="button" class="wc-button" @click="addPanel">Add panel</button>
      <button type="button" class="wc-button" :disabled="selected === null || panels.length < 2" @click="deletePanel">
        Delete panel
      </button>
      <span class="wc-plan__sep" />
      <button type="button" class="wc-button" :disabled="!canUndo" title="Undo (Ctrl+Z)" @click="emit('undo')">
        Undo
      </button>
      <button type="button" class="wc-button" :disabled="!canRedo" title="Redo (Ctrl+Y)" @click="emit('redo')">
        Redo
      </button>
      <span class="wc-plan__sep" />
      <label class="wc-check"><input v-model="snapOn" type="checkbox" /> Snap to grid</label>
      <span class="wc-plan__spacer" />
      <button type="button" class="wc-button" aria-label="Zoom out" @click="zoomAt(1 / 1.25, width / 2, HEIGHT / 2)">
        −
      </button>
      <button type="button" class="wc-button" aria-label="Zoom in" @click="zoomAt(1.25, width / 2, HEIGHT / 2)">+</button>
      <button type="button" class="wc-button" @click="fit">Fit</button>
    </div>

    <div
      ref="wrapEl"
      class="wc-plan__canvas"
      tabindex="0"
      aria-label="Wing plan editor. Arrow keys move the selected panel's tip; Delete removes it."
      @keydown="onKey"
    >
      <svg
        ref="svgEl"
        :viewBox="viewBox"
        :width="width"
        :height="HEIGHT"
        class="wc-plan__svg"
        :class="{ 'wc-plan__svg--panning': drag?.kind === 'pan' }"
        @pointerdown.self="startPan($event, { deselect: true })"
        @pointermove="moveHandle"
        @pointerup="endHandle"
        @pointercancel="endHandle"
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

        <!-- Panels -->
        <polygon
          v-for="p in shapes"
          :key="'p' + p.panel.id"
          :points="p.polygonPts"
          class="wc-plan__panel"
          :class="{ 'wc-plan__panel--selected': selected === p.index }"
          @pointerdown="startPan($event, { select: p.index })"
        />
        <polyline v-for="p in shapes" :key="'q' + p.panel.id" :points="p.quarter" class="wc-plan__quarter" pointer-events="none" />

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

        <!-- Handles -->
        <g class="wc-plan__handles">
          <!-- Fuselage side -->
          <polygon :points="fuseHandle" class="wc-plan__handle wc-plan__handle--fuse" @pointerdown="startHandle($event, 'fuse')">
            <title>Fuselage width: drag sideways</title>
          </polygon>
          <!-- Root chord -->
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
          <!-- Curve handles on the selected panel -->
          <template v-if="selShape">
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

        <!-- Dimensions for the selected panel -->
        <g v-if="selShape" class="wc-plan__dims" pointer-events="none" :font-size="px(11)">
          <text :x="(selShape.inner.s + selShape.outer.s) / 2" :y="Math.min(selShape.inner.x, selShape.outer.x) - px(10)" text-anchor="middle">
            {{ fmt(selShape.panel.length) }}
          </text>
          <text :x="selShape.outer.s + px(10)" :y="selShape.outer.x + selShape.outer.c / 2" dominant-baseline="middle">
            {{ fmt(selShape.outer.c) }}
          </text>
        </g>
      </svg>
      <p class="wc-plan__readout" aria-live="polite">
        <template v-if="readout">{{ readout }}</template>
        <template v-else-if="selected !== null">
          Panel {{ selected + 1 }} selected. Drag the round handles at its tip; drag the small ones on its edges to curve
          them.
        </template>
        <template v-else>Click a panel to select it. Drag to pan, scroll to zoom. Alt disables snapping.</template>
      </p>
    </div>
  </div>
</template>
