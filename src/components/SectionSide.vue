<script setup>
// The section editor's side panel: readouts, the leading-edge radius, the selected point, the curvature check and the
// XFOIL preview. The numbers and the warning list are taken from the outline as it was when the last drag ended, so
// they hold still while a point is dragged. Edits go up as a new point list (one history step).
// The preview solves the outline one second after an edit settles (never during a drag), through the page's polar
// solver: the jobs go up to the parent, which queues them ahead of the wing's, and `lookup` reads the results back.
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { analyseSection, leIndex, normalise, setPointAt, applyRadius, NOSE_MIN, NOSE_MAX, sectionCoords } from '../lib/sectionSpline.js'
import { analysePolar } from '../lib/stall.js'
import { usableComputedPolar } from '../lib/airfoils.js'
import { XFOIL_SETTINGS, coordsKey, settingsKey, polarSegments } from '../lib/xfoil.js'
import LiftCurve from './LiftCurve.vue'

const props = defineProps({
  pts: { type: Array, required: true },
  selection: { type: Object, default: () => ({ points: [], segments: [] }) },
  dragging: { type: Boolean, default: false },
  // The outline as it was when the editor opened (drawn faintly for comparison)
  start: { type: Array, default: null },
  // The Reynolds number the wing is solved at on the main page
  re: { type: Number, default: 200000 },
  // The page's polar cache: lookup(key) gives { ok, polar } or null
  lookup: { type: Function, default: () => null },
})
const emit = defineEmits(['edit', 'select', 'action', 'hover', 'jobs'])

const pc = (n, d = 1) => (n * 100).toFixed(d)

// Frozen while a drag is in progress; refreshed when the drag ends (or when nothing is being dragged)
const settled = ref(props.pts)
watch(
  () => [props.pts, props.dragging],
  ([P, drag]) => {
    if (!drag) settled.value = P
  },
  { immediate: true },
)
const A = computed(() => analyseSection(settled.value))

const readouts = computed(() => {
  const a = A.value
  return {
    thick: `${pc(a.tmax)} % at ${pc(a.xt, 0)} %`,
    camber: `${pc(a.cmax)} % at ${pc(a.xc, 0)} %`,
    leR: `${pc(a.leR, 2)} %`,
    teA: `${a.teA.toFixed(1)}°`,
  }
})

// The warnings: each surface where the curvature changes direction twice or more
const warnings = computed(() => A.value.infls.map((e, k) => ({ e, k })).filter(({ e }) => e.warn))

// Live values for the editable fields (not frozen)
const lePct = computed(() => (props.pts[leIndex(props.pts)]?.r ?? 0) * 100)
const norm = computed(() => normalise(props.pts).pts)
const selIdx = computed(() => (props.selection.points?.length === 1 ? props.selection.points[0] : null))
const selPoint = computed(() => {
  const i = selIdx.value
  if (i == null || !props.pts[i]) return null
  const l = leIndex(props.pts)
  const q = norm.value[i]
  return {
    i,
    le: i === l,
    label: i === l ? 'Leading edge' : i < l ? `Upper point ${i + 1}` : `Lower point ${i - l}`,
    x: q.x * 100,
    y: q.y * 100,
  }
})
const multi = computed(() => (props.selection.points?.length ?? 0) > 1)

// --- XFOIL preview ------------------------------------------------------------------------
// The outline the preview solves: the current one, one second after the last edit settles
const preview = ref(props.pts)
let previewTimer = null
watch(
  () => [props.pts, props.dragging],
  ([P, drag]) => {
    clearTimeout(previewTimer)
    if (drag) return
    previewTimer = setTimeout(() => {
      preview.value = P
    }, 1000)
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  clearTimeout(previewTimer)
  emit('jobs', [])
})

// A polar job keyed like the page's own (coords and settings), so the cache is shared by identical shapes only
const jobFor = (pts) => {
  const coords = sectionCoords(pts)
  return { key: `${coordsKey(coords)}|${settingsKey(XFOIL_SETTINGS)}@${props.re}`, coords, re: props.re, settings: { ...XFOIL_SETTINGS } }
}
const draftJob = computed(() => jobFor(preview.value))
const startJob = computed(() => (props.start ? jobFor(props.start) : null))
const startDiffers = computed(() => !!startJob.value && startJob.value.key !== draftJob.value.key)
watch(
  () => [draftJob.value.key, startDiffers.value ? startJob.value.key : null],
  () => emit('jobs', startDiffers.value ? [draftJob.value, startJob.value] : [draftJob.value]),
  { immediate: true },
)

// A cache entry is usable when it's a computed polar with a fair number of converged points
const usable = (e) => (e?.ok && usableComputedPolar(e.polar) ? e.polar : null)
const draftEntry = computed(() => props.lookup(draftJob.value.key))
const polar = computed(() => usable(draftEntry.value))
const failed = computed(() => !!draftEntry.value && !polar.value)
const startPolar = computed(() => (startDiffers.value ? usable(props.lookup(startJob.value.key)) : null))

// The last good polar stays on show (faded) while the next one is solved
const lastGood = ref(null)
watch(polar, (p) => {
  if (p) lastGood.value = p
}, { immediate: true })
const shown = computed(() => polar.value ?? lastGood.value)

const status = computed(() => {
  if (props.dragging) return 'Out of date: still dragging'
  if (preview.value !== props.pts) return 'Solving…'
  if (failed.value) return "XFOIL couldn't converge on this shape"
  if (!polar.value) return 'Solving…'
  return null
})

const stallOf = (p) => {
  const m = analysePolar(p)
  return { clMax: m.clMax, alpha: m.alphaClMax }
}
const curve = computed(() => {
  const p = shown.value
  if (!p) return null
  const sp = startPolar.value
  return {
    alpha: p.alpha,
    cl: p.cl,
    re: p.re,
    segments: polarSegments(p),
    peak: { alpha: stallOf(p).alpha, cl: stallOf(p).clMax },
    indicative: false,
    computed: true,
    reference: sp && sp !== polar.value ? { alpha: sp.alpha, cl: sp.cl, re: sp.re } : undefined,
  }
})
const stallText = (p) => {
  const s = stallOf(p)
  return `Clmax ${s.clMax.toFixed(2)}, stall at ${s.alpha.toFixed(1)}°`
}
const reText = `Re ${Math.round(props.re / 1000)}k`

// Edits: a value typed in is clamped and applied as one step. Bad input is ignored.
function setRadius(v) {
  const r = Number(v)
  if (!Number.isFinite(r)) return
  const clamped = Math.min(NOSE_MAX * 100, Math.max(NOSE_MIN * 100, r))
  emit('edit', { pts: applyRadius(props.pts, clamped / 100), message: 'Set the leading-edge radius' })
}
function setPoint(axis, v) {
  const p = selPoint.value
  const n = Number(v)
  if (!p || p.le || !Number.isFinite(n)) return
  const nx = axis === 'x' ? n / 100 : p.x / 100
  const ny = axis === 'y' ? n / 100 : p.y / 100
  emit('edit', { pts: setPointAt(props.pts, p.i, nx, ny), message: 'Moved the point' })
}
</script>

<template>
  <div class="wc-sec-side" aria-label="Readouts and checks">
    <section aria-label="Readouts">
      <h3 class="wc-side__title">Readouts</h3>
      <dl class="wc-side__readouts">
        <dt>Thickness</dt><dd>{{ readouts.thick }}</dd>
        <dt>Camber</dt><dd>{{ readouts.camber }}</dd>
        <dt>Nose radius, measured</dt><dd>{{ readouts.leR }}</dd>
        <dt>Trailing-edge angle</dt><dd>{{ readouts.teA }}</dd>
      </dl>
    </section>

    <section aria-label="Leading edge">
      <h3 class="wc-side__title">Leading edge</h3>
      <div class="wc-field">
        <label class="wc-field__label" for="wc-sec-ler">Radius</label>
        <div class="wc-field__control">
          <input id="wc-sec-ler" class="wc-input" type="number" step="0.05" :min="NOSE_MIN * 100" :max="NOSE_MAX * 100" :value="lePct.toFixed(2)" @change="setRadius($event.target.value)" />
          <span class="wc-muted">% chord</span>
        </div>
        <p class="wc-field__hint">Drag the diamond along the chord, or type a value. The outline has exactly this radius at the leading edge.</p>
      </div>
    </section>

    <section aria-label="Selected point">
      <h3 class="wc-side__title">Selected point</h3>
      <template v-if="selPoint">
        <p class="wc-muted">{{ selPoint.label }}</p>
        <template v-if="!selPoint.le">
          <div class="wc-field">
            <label class="wc-field__label" for="wc-sec-px">Position along the chord</label>
            <div class="wc-field__control">
              <input id="wc-sec-px" class="wc-input" type="number" step="0.05" :value="selPoint.x.toFixed(2)" @change="setPoint('x', $event.target.value)" />
              <span class="wc-muted">% chord</span>
            </div>
          </div>
          <div class="wc-field">
            <label class="wc-field__label" for="wc-sec-py">Height</label>
            <div class="wc-field__control">
              <input id="wc-sec-py" class="wc-input" type="number" step="0.05" :value="selPoint.y.toFixed(2)" @change="setPoint('y', $event.target.value)" />
              <span class="wc-muted">% chord</span>
            </div>
          </div>
        </template>
      </template>
      <template v-else-if="multi">
        <p class="wc-muted">{{ selection.points.length }} points selected</p>
        <div class="wc-field__control">
          <button type="button" class="wc-button" @click="emit('action', 'smooth')">Smooth</button>
          <button type="button" class="wc-button" @click="emit('action', 'mirror')">Mirror</button>
          <button type="button" class="wc-button" @click="emit('action', 'delete')">Delete</button>
        </div>
      </template>
      <p v-else class="wc-muted">Click a point to move it. Drag the background to select several. Segments are edited from the bar above the drawing.</p>
    </section>

    <section aria-label="Curvature check">
      <h3 class="wc-side__title">Curvature check</h3>
      <div class="wc-side__check">
        <p v-if="dragging" class="wc-muted">Updates when you let go.</p>
        <ul v-if="warnings.length" class="wc-side__warnings" aria-label="Curvature warnings">
          <li v-for="w in warnings" :key="w.k">
            <button
              type="button"
              class="wc-side__warn"
              title="Select the points either side and zoom to them"
              @click="emit('select', { points: [w.e.pa, w.e.pb], segments: [] })"
              @mouseenter="emit('hover', w.k)"
              @mouseleave="emit('hover', -1)"
              @focus="emit('hover', w.k)"
              @blur="emit('hover', -1)"
            >{{ w.e.surf }} surface: the curvature reverses twice, near {{ pc(w.e.x, 0) }} % chord ({{ w.e.k + 1 }} of {{ w.e.of }})</button>
          </li>
        </ul>
        <p v-if="A.cross" class="wc-side__warn wc-side__warn--static">The two surfaces cross over.</p>
        <p v-if="!warnings.length && !A.cross && !dragging" class="wc-muted">No wobbles: each surface bends one way.</p>
      </div>
    </section>

    <section aria-label="XFOIL preview" class="wc-side__xf">
      <h3 class="wc-side__title">XFOIL preview</h3>
      <p v-if="status" class="wc-muted" role="status">{{ status }}</p>
      <template v-if="curve && !failed">
        <div :class="{ 'wc-sec-side__stale': status }">
          <LiftCurve :curve="curve" />
        </div>
        <p class="wc-muted">{{ reText }}: {{ stallText(shown) }}</p>
        <p v-if="curve.reference" class="wc-muted">Faint: the section when you opened the editor, {{ stallText(startPolar) }}.</p>
      </template>
    </section>
  </div>
</template>
