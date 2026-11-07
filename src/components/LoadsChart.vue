<script setup>
// Along the span from the root rib: bending moment at the design load, and the margin of
// safety for each failure mode at each station (0 is just enough), with a legend; the
// lowest is marked. Rib positions are ticked. Hovering either chart draws a line across both
// at that span position and reads every curve there. The corner button opens the same charts
// to fill the window, over the page (the component again, expanded, its charts drawn at the
// size they're shown so the text stays its usual size); Escape, Close or the backdrop closes it.
// Each chart has its title and key above it and its own readout under it; both charts are drawn
// at the size they're shown, so their text is the same size in the card and expanded.
//
// Expanded, the charts zoom along the span together: the wheel zooms about the pointer, a drag
// pans, and − + Fit (bottom right) or F, + and − do the same. The moment axis fits what's in
// view; the margins keep their scale.
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { MODES, MODE_SLOTS } from '../lib/structure.js'
import { format, defaultUnit } from '../lib/units.js'
import { EXPAND, SHRINK, INFO } from '../lib/icons.js'
import LoadsChart from './LoadsChart.vue'
import StageZoom from './StageZoom.vue'

const props = defineProps({
  analysis: { type: Object, required: true },
  ribs: { type: Array, required: true }, // parts of group 'ribs'
  system: { type: [String, Object], required: true }, // a units setting (units.js normaliseUnits) or system name
  designG: { type: Number, required: true },
  // Drawn larger, in the overlay
  expanded: { type: Boolean, default: false },
})
const emit = defineEmits(['close'])

// Drawn at the width they're shown, in px, each chart half the height the stage has once its
// titles and readouts are in: expanded, the panel's; in the card, the row's (the Part card beside
// it sets that, see .wc-card--fill), never under 150 px
const stageEl = ref(null)
const stage = ref({ w: 520, h: 0 })
const W = computed(() => Math.max(300, stage.value.w))
const H = computed(() => Math.max(props.expanded ? 160 : 150, Math.floor(stage.value.h / 2) - 2))
const M = { l: 44, r: 10, t: 10, b: 22 }
let stageObs = null
onMounted(() => {
  if (!stageEl.value || typeof ResizeObserver === 'undefined') return
  // The width, and the height left for the two charts once the titles and readouts are in
  const measure = () => {
    const el = stageEl.value
    if (!el) return
    let other = 0
    for (const c of el.children) {
      if (c.tagName.toLowerCase() === 'svg' || c.classList.contains('wc-loads__plot')) continue
      const cs = getComputedStyle(c)
      if (cs.position === 'absolute') continue
      other += c.offsetHeight + parseFloat(cs.marginTop) + parseFloat(cs.marginBottom)
    }
    stage.value = { w: el.clientWidth, h: el.clientHeight - other }
  }
  stageObs = new ResizeObserver(measure)
  stageObs.observe(stageEl.value)
  measure()
})
onBeforeUnmount(() => stageObs?.disconnect())
const MS_MAX = 3
const MS_MIN = -1

// The stretch of span in view, from the root rib (null: all of it). Only expanded.
const span = computed(() => props.analysis.tipS - props.analysis.rootS)
const view = ref(null)
const win = computed(() => {
  const v = props.expanded ? view.value : null
  return v ? v : { d0: 0, d1: span.value }
})
// Each chart's height in view, as fractions { f0, f1 } of its full scale (the moment's fitted to
// the span in view, the margins' −1 to +3); null: all of it. m the moment chart, s the margins.
const yView = ref({ m: null, s: null })
const yWin = (k) => (props.expanded && yView.value[k]) || { f0: 0, f1: 1 }
const zoomed = computed(() => !!(props.expanded && (view.value || yView.value.m || yView.value.s)))
// Never closer in than a fiftieth of the span
const minWidth = computed(() => span.value / 50)
function setView(d0, d1) {
  const S = span.value
  let w = Math.min(S, Math.max(minWidth.value, d1 - d0))
  if (w >= S - 1e-9) {
    view.value = null
    return
  }
  d0 = Math.min(S - w, Math.max(0, d0))
  view.value = { d0, d1: d0 + w }
}
function setY(k, f0, f1) {
  const w = Math.min(1, Math.max(1 / 50, f1 - f0))
  if (w >= 1 - 1e-9) {
    yView.value = { ...yView.value, [k]: null }
    return
  }
  f0 = Math.min(1 - w, Math.max(0, f0))
  yView.value = { ...yView.value, [k]: { f0, f1: f0 + w } }
}
// Zoom by k (over 1 is in) about span position d (the middle of the view without one), and the
// height of chart `only` (both without one) about fraction fy of its scale (the middle without)
function zoomBy(k, d = null, only = null, fy = null) {
  const { d0, d1 } = win.value
  const at = d ?? (d0 + d1) / 2
  const w = (d1 - d0) / k
  const f = (at - d0) / (d1 - d0)
  setView(at - f * w, at - f * w + w)
  for (const c of only ? [only] : ['m', 's']) {
    const { f0, f1 } = yWin(c)
    const y = fy ?? (f0 + f1) / 2
    const h = (f1 - f0) / k
    const g = (y - f0) / (f1 - f0)
    setY(c, y - g * h, y - g * h + h)
  }
}
const fitSpan = () => {
  view.value = null
  yView.value = { m: null, s: null }
}
// The span position under a pointer event on either chart, or null off the plot
function spanAt(e) {
  const r = e.currentTarget.getBoundingClientRect()
  if (!(r.width > 0)) return null
  const vx = ((e.clientX - r.left) / r.width) * W.value
  const f = (vx - M.l) / (W.value - M.l - M.r)
  if (f < 0 || f > 1) return null
  const { d0, d1 } = win.value
  return d0 + f * (d1 - d0)
}
// The fraction of chart k's scale under a pointer event, or null off the plot
function scaleAt(e, k) {
  const r = e.currentTarget.getBoundingClientRect()
  if (!(r.height > 0)) return null
  const vy = ((e.clientY - r.top) / r.height) * H.value
  const g = 1 - (vy - M.t) / (H.value - M.t - M.b)
  if (g < 0 || g > 1) return null
  const { f0, f1 } = yWin(k)
  return f0 + g * (f1 - f0)
}
function onWheel(e, k) {
  if (!props.expanded) return
  e.preventDefault()
  zoomBy(Math.exp(-e.deltaY * 0.0015), spanAt(e), k, scaleAt(e, k))
}
// Drag to pan, once zoomed in: along the span (both charts) and up and down (this one)
let drag = null
function onDown(e, k) {
  if (!zoomed.value || e.button !== 0) return
  const r = e.currentTarget.getBoundingClientRect()
  drag = {
    k,
    x: e.clientX,
    y: e.clientY,
    view: { ...win.value },
    y0: { ...yWin(k) },
    px: (r.width * (W.value - M.l - M.r)) / W.value,
    py: (r.height * (H.value - M.t - M.b)) / H.value,
  }
  e.currentTarget.setPointerCapture?.(e.pointerId)
}
function onMove(e) {
  if (drag) {
    const w = drag.view.d1 - drag.view.d0
    if (w < span.value - 1e-9) {
      const dd = (-(e.clientX - drag.x) / Math.max(1, drag.px)) * w
      setView(drag.view.d0 + dd, drag.view.d1 + dd)
    }
    const h = drag.y0.f1 - drag.y0.f0
    if (h < 1 - 1e-9) {
      const df = ((e.clientY - drag.y) / Math.max(1, drag.py)) * h
      setY(drag.k, drag.y0.f0 + df, drag.y0.f1 + df)
    }
  }
  onHover(e)
}
function onUp() {
  drag = null
}
// F, + and − while expanded (the overlay is modal, so the window's keys are the chart's)
function onZoomKey(e) {
  if (e.ctrlKey || e.metaKey || e.altKey || e.target?.closest?.('input, select, textarea')) return
  if (e.key === 'f' || e.key === 'F') fitSpan()
  else if (e.key === '+' || e.key === '=') zoomBy(1.25)
  else if (e.key === '-' || e.key === '_') zoomBy(1 / 1.25)
  else return
  e.preventDefault()
}
// Each chart's pointer handlers: hover in the card; zoom and pan as well expanded
const handlers = (k) =>
  props.expanded
    ? { onPointermove: onMove, onPointerdown: (e) => onDown(e, k), onPointerup: onUp, onPointercancel: onUp, onWheel: (e) => onWheel(e, k) }
    : { onPointermove: onHover }
const svgOnM = computed(() => handlers('m'))
const svgOnS = computed(() => handlers('s'))
onMounted(() => props.expanded && typeof window !== 'undefined' && window.addEventListener('keydown', onZoomKey))
onBeforeUnmount(() => typeof window !== 'undefined' && window.removeEventListener('keydown', onZoomKey))

const chart = computed(() => {
  const st = props.analysis.stations
  const W_ = W.value
  const H_ = H.value
  const { d0, d1 } = win.value
  const x = (d) => M.l + ((d - d0) / (d1 - d0)) * (W_ - M.l - M.r)
  const inView = (d) => d >= d0 - 1e-9 && d <= d1 + 1e-9
  // The moment axis fits what's in view (the stations there and the curve at each edge)
  const seen = st.filter((r) => inView(r.d)).map((r) => Math.max(r.M, r.Mneg ?? 0))
  for (const d of [d0, d1]) seen.push(valueAt((r) => r.M, d) ?? 0, valueAt((r) => r.Mneg, d) ?? 0)
  const mMax = Math.max(...seen, 1e-6)
  // Each chart's height in view: a fraction g of its scale to a height on the chart
  const ym = yWin('m')
  const ys = yWin('s')
  const yOf = (g, w) => H_ - M.b - ((g - w.f0) / (w.f1 - w.f0)) * (H_ - M.t - M.b)
  const yM = (v) => yOf(v / mMax, ym)
  const sOf = (g) => MS_MIN + g * (MS_MAX - MS_MIN)
  const yS = (v) => yOf((Math.min(MS_MAX, Math.max(MS_MIN, v)) - MS_MIN) / (MS_MAX - MS_MIN), ys)
  const signed = (v, dp) => `${v > 1e-9 ? '+' : ''}${v.toFixed(dp)}`
  const sTop = sOf(ys.f1)
  const sBot = sOf(ys.f0)
  const sDp = sTop - sBot < 0.5 ? 2 : sTop - sBot < 3 ? 1 : 0
  const lowest = st.map((r) => {
    let m = Infinity
    let mode = null
    for (const [k, v] of Object.entries(r.ms)) {
      if (Number.isFinite(v) && v < m) {
        m = v
        mode = k
      }
    }
    return { d: r.d, m, mode }
  })
  const msPts = lowest.filter((p) => Number.isFinite(p.m))
  // One line per mode, each in its own colour slot whatever else is present (a foam wing's names
  // for them from the analysis)
  const labels = props.analysis.modeLabels ?? MODES
  const modes = Object.keys(MODES)
    .map((k, i) => {
      const pts = st.filter((r) => Number.isFinite(r.ms[k]))
      if (!pts.length) return null
      const low = pts.reduce((w, r) => (r.ms[k] < w.ms[k] ? r : w))
      return { key: k, slot: MODE_SLOTS[k] ?? i + 1, label: labels[k], low: low.ms[k], points: pts.map((r) => `${x(r.d).toFixed(1)},${yS(r.ms[k]).toFixed(1)}`).join(' ') }
    })
    .filter(Boolean)
  const worst = msPts.reduce((w, p) => (!w || p.m < w.m ? p : w), null)
  const lengthUnit = defaultUnit(props.system, 'length')
  // Dihedral braces: one marker per break that can be made, clamped to the chart and flagged when off scale
  const rootS = props.analysis.rootS
  const braces = (props.analysis.braces ?? [])
    .filter((b) => b.ok && Number.isFinite(b.margin))
    .map((b) => {
      const off = b.margin > MS_MAX ? 'above' : b.margin < MS_MIN ? 'below' : null
      return { name: b.name, x: x(b.s - rootS), y: yS(b.margin), margin: b.margin, off, d: b.s - rootS }
    })
    .filter((b) => inView(b.d))
  return {
    x,
    braces,
    breakX: (props.analysis.braces ?? []).filter((b) => b.ok && inView(b.s - rootS)).map((b) => x(b.s - rootS)),
    moment: st.map((r) => `${x(r.d).toFixed(1)},${yM(r.M).toFixed(1)}`).join(' '),
    momentNeg: st.some((r) => r.Mneg > 0) ? st.map((r) => `${x(r.d).toFixed(1)},${yM(r.Mneg).toFixed(1)}`).join(' ') : null,
    mMax,
    yM,
    // The ends of each chart's scale in view, and 0 on the margins when it's in view
    mTop: (mMax * ym.f1).toFixed(1),
    mBot: ym.f0 > 1e-9 ? (mMax * ym.f0).toFixed(1) : '0',
    sTop: signed(sTop, sDp),
    sBot: signed(sBot, sDp),
    sZero: 0 > sBot + (sTop - sBot) * 0.08 && 0 < sTop - (sTop - sBot) * 0.08,
    modes,
    zero: yS(0),
    yS,
    worst,
    ribX: props.ribs.filter((p) => inView(p.s - rootS)).map((p) => x(p.s - rootS)),
    spanLabel: format(span.value, 'length', lengthUnit),
    // The ends of the axis: the root rib and the tip, or where the view starts and ends
    fromLabel: d0 > 1e-9 ? format(d0, 'length', lengthUnit) : 'root rib',
    toLabel: d1 < span.value - 1e-9 ? format(d1, 'length', lengthUnit) : `tip, ${format(span.value, 'length', lengthUnit)}`,
    worstShown: !!worst && inView(worst.d),
  }
})

// The crosshair: the span position under the pointer, and every curve's value there
const hoverD = ref(null)
function onHover(e) {
  if (!(e.currentTarget.getBoundingClientRect().width > 0)) return
  hoverD.value = spanAt(e)
}
// Linear between the stations either side of d, over those where get gives a number
function valueAt(get, d) {
  const st = props.analysis.stations.filter((r) => Number.isFinite(get(r)))
  if (!st.length || d < st[0].d - 1e-9 || d > st.at(-1).d + 1e-9) return null
  let i = st.findIndex((r) => r.d >= d)
  if (i <= 0) return get(st[Math.max(0, i)])
  const a = st[i - 1], b = st[i]
  const t = b.d - a.d > 1e-12 ? (d - a.d) / (b.d - a.d) : 0
  return get(a) + (get(b) - get(a)) * t
}
// Each chart's readout: the moment at the design load and in the negative case, and every
// mode's margin. Not pointing: the same entries with no values, so the lines keep their shape
// and the page doesn't move.
const hasNeg = computed(() => props.analysis.stations.some((r) => r.Mneg > 0))
const readout = computed(() => {
  const d = hoverD.value
  const signed = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}`
  // Not pointing: the moment at the root, and each mode's lowest margin along the span
  const at = (get, show) => {
    const v = valueAt(get, d ?? 0)
    return v == null ? '' : show(v)
  }
  const bending = [{ key: 'M', line: 'solid', label: `at ${props.designG} g`, value: at((r) => r.M, nm) }]
  if (hasNeg.value) bending.push({ key: 'Mn', line: 'dashed', label: 'negative', value: at((r) => r.Mneg, nm) })
  const worst = chart.value.worst?.mode
  const margins = chart.value.modes.map((m) => ({ key: m.key, slot: m.slot, label: m.label, value: d == null ? signed(m.low) : at((r) => r.ms[m.key], signed), worst: d == null && m.key === worst }))
  return { x: d == null ? null : chart.value.x(d), at: d == null ? null : format(d, 'length', defaultUnit(props.system, 'length')), bending, margins }
})

// The notes, shown over the card on the info button
const notesOpen = ref(false)
const uid = `wc-loads-${Math.random().toString(36).slice(2, 8)}`

// The overlay: Escape or the backdrop closes it
const big = ref(false)
function onKey(e) {
  if (e.key === 'Escape') {
    e.stopPropagation()
    if (props.expanded) emit('close')
    else big.value = false
  }
}
watch(big, (open) => {
  if (typeof window === 'undefined') return
  if (open) window.addEventListener('keydown', onKey, true)
  else window.removeEventListener('keydown', onKey, true)
})
onBeforeUnmount(() => typeof window !== 'undefined' && window.removeEventListener('keydown', onKey, true))
function nm(v) {
  return `${v.toFixed(v < 10 ? 2 : 1)} N·m`
}
</script>

<template>
  <figure class="wc-figure wc-loads" :class="{ 'wc-loads--expanded': expanded }">
    <button v-if="!expanded" type="button" class="wc-iconbtn wc-loads__info" :aria-expanded="String(notesOpen)" :aria-controls="`${uid}-notes`" aria-label="Notes on these charts" title="Notes on these charts" @click="notesOpen = !notesOpen">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path v-for="(d, k) in INFO" :key="k" :d="d" /></svg>
    </button>
    <button v-if="!expanded" type="button" class="wc-iconbtn wc-loads__expand" aria-label="Show the loads charts larger" title="Show larger" @click="big = true">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path v-for="(d, k) in EXPAND" :key="k" :d="d" /></svg>
    </button>
    <button v-else type="button" class="wc-iconbtn wc-loads__expand" aria-label="Back to the card" title="Back to the card (Esc)" @click="emit('close')">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path v-for="(d, k) in SHRINK" :key="k" :d="d" /></svg>
    </button>
    <div ref="stageEl" class="wc-loads__stage">
    <div class="wc-loads__head">
      <span class="wc-loads__title">Bending moment, N·m</span>
      <span class="wc-loads__key"><span class="wc-loads__line" aria-hidden="true"></span>at {{ designG }} g</span>
      <span v-if="hasNeg" class="wc-loads__key"><span class="wc-loads__line wc-loads__line--dashed" aria-hidden="true"></span>negative case</span>
    </div>
    <svg :viewBox="`0 0 ${W} ${H}`" :width="W" :height="H" role="img" aria-label="Bending moment along the span" v-bind="svgOnM" :class="{ 'wc-loads__pan': zoomed }" @pointerleave="hoverD = null">
      <defs>
        <clipPath :id="`${uid}-plot`"><rect :x="M.l" :y="0" :width="W - M.l - M.r" :height="H" /></clipPath>
      </defs>
      <line v-for="(x, i) in chart.ribX" :key="'r' + i" :x1="x" :x2="x" :y1="M.t" :y2="H - M.b" class="wc-loads__rib" />
      <line :x1="M.l" :x2="W - M.r" :y1="H - M.b" :y2="H - M.b" class="wc-svg-axis" />
      <g :clip-path="`url(#${uid}-plot)`">
        <polyline v-if="chart.momentNeg" :points="chart.momentNeg" class="wc-svg-curve wc-svg-curve--indicative" />
        <polyline :points="chart.moment" class="wc-svg-curve" />
      </g>
      <line v-for="(x, i) in chart.breakX" :key="'b' + i" :x1="x" :x2="x" :y1="M.t" :y2="H - M.b" class="wc-loads__break" />
      <text :x="M.l - 4" :y="M.t + 4" text-anchor="end" class="wc-svg-tick">{{ chart.mTop }}</text>
      <text :x="M.l - 4" :y="H - M.b" text-anchor="end" class="wc-svg-tick">{{ chart.mBot }}</text>
      <text :x="M.l" :y="H - 6" class="wc-svg-tick">{{ chart.fromLabel }}</text>
      <text :x="W - M.r" :y="H - 6" text-anchor="end" class="wc-svg-tick">{{ chart.toLabel }}</text>
      <line v-if="readout.x != null" :x1="readout.x" :x2="readout.x" :y1="M.t" :y2="H - M.b" class="wc-loads__cross" />
    </svg>
    <p class="wc-loads__readout" aria-live="polite">
      <span class="wc-loads__at">
        <template v-if="readout.at"><strong>{{ readout.at }}</strong> from the root rib:</template>
        <span v-else class="wc-muted">At the root rib:</span>
      </span>
      <span v-for="it in readout.bending" :key="it.key" class="wc-loads__reading">
        <span :class="['wc-loads__line', { 'wc-loads__line--dashed': it.line === 'dashed' }]" aria-hidden="true"></span>{{ it.label }}
        <span class="wc-loads__value">{{ it.value }}</span>
      </span>
    </p>
    <div class="wc-loads__head"><span class="wc-loads__title">Margin of safety by failure mode</span></div>
    <div class="wc-loads__plot">
    <svg :viewBox="`0 0 ${W} ${H}`" :width="W" :height="H" role="img" aria-label="Lowest margin of safety along the span" v-bind="svgOnS" :class="{ 'wc-loads__pan': zoomed }" @pointerleave="hoverD = null">
      <defs>
        <clipPath :id="`${uid}-margins`"><rect :x="M.l" :y="M.t - 1" :width="W - M.l - M.r" :height="H - M.t - M.b + 2" /></clipPath>
      </defs>
      <g :clip-path="`url(#${uid}-margins)`">
        <rect :x="M.l" :y="chart.zero" :width="W - M.l - M.r" :height="Math.max(0, H - chart.zero)" class="wc-loads__bad" />
        <line :x1="M.l" :x2="W - M.r" :y1="chart.zero" :y2="chart.zero" class="wc-svg-axis" />
      </g>
      <line v-for="(x, i) in chart.ribX" :key="'r' + i" :x1="x" :x2="x" :y1="M.t" :y2="H - M.b" class="wc-loads__rib" />
      <g :clip-path="`url(#${uid}-margins)`">
        <polyline
          v-for="m in chart.modes"
          :key="m.key"
          :points="m.points"
          :class="['wc-loads__mode', `wc-loads__mode--${m.slot}`, { 'wc-loads__mode--worst': m.key === chart.worst?.mode }]"
        >
          <title>{{ m.label }}: lowest {{ m.low >= 0 ? '+' : '' }}{{ m.low.toFixed(2) }}</title>
        </polyline>
        <circle v-if="chart.worstShown" :cx="chart.x(chart.worst.d)" :cy="chart.yS(chart.worst.m)" r="3.5" class="wc-svg-peak" />
      </g>
      <g v-for="b in chart.braces" :key="'brace' + b.name" :clip-path="`url(#${uid}-plot)`">
        <title>{{ b.name }}: margin {{ b.margin >= 0 ? '+' : '' }}{{ b.margin.toFixed(2) }}{{ b.off ? ` (off scale, ${b.off} the chart)` : '' }}</title>
        <circle :cx="b.x" :cy="b.y" r="3" class="wc-loads__brace" />
        <text :x="b.x" :y="b.y - 6" text-anchor="middle" class="wc-svg-tick">{{ b.name }}{{ b.off === 'above' ? ' ▲' : b.off === 'below' ? ' ▼' : '' }}</text>
      </g>
      <text :x="M.l - 4" :y="M.t + 4" text-anchor="end" class="wc-svg-tick">{{ chart.sTop }}</text>
      <text v-if="chart.sZero" :x="M.l - 4" :y="chart.zero + 3" text-anchor="end" class="wc-svg-tick">0</text>
      <text :x="M.l - 4" :y="H - M.b" text-anchor="end" class="wc-svg-tick">{{ chart.sBot }}</text>
      <line v-if="readout.x != null" :x1="readout.x" :x2="readout.x" :y1="M.t" :y2="H - M.b" class="wc-loads__cross" />
    </svg>
    <StageZoom v-if="expanded" fit-title="Show it all (F)" @zoom-in="zoomBy(1.25)" @zoom-out="zoomBy(1 / 1.25)" @fit="fitSpan" />
    </div>
    <p class="wc-loads__readout" aria-live="polite">
      <span class="wc-loads__at">
        <template v-if="readout.at"><strong>{{ readout.at }}</strong> from the root rib:</template>
        <span v-else class="wc-muted">Lowest along the span:</span>
      </span>
      <span v-for="it in readout.margins" :key="it.key" :class="['wc-loads__reading', { 'wc-loads__reading--worst': it.worst }]">
        <span :class="['wc-loads__swatch', `wc-loads__mode--${it.slot}`]" aria-hidden="true"></span>{{ it.label }}
        <span class="wc-loads__value">{{ it.value }}</span>
      </span>
      <span v-if="chart.braces.length" class="wc-loads__reading">
        <span class="wc-loads__brace-key" aria-hidden="true"></span>Dihedral brace
      </span>
    </p>
    </div>
    <!-- The notes: under the charts when expanded; in the card, behind the info button -->
    <figcaption v-if="expanded || notesOpen" :id="`${uid}-notes`" :class="['wc-figure__caption', { 'wc-loads__notes': !expanded }]">
      <span>
        Root bending {{ nm(analysis.rootMoment) }} and shear {{ analysis.rootShear.toFixed(0) }} N at
        {{ designG }} g (solid; dashed is the negative case).<template v-if="ribs.length"> Ribs are the vertical ticks.</template>
      </span>
      <span v-if="chart.worst">
        Lowest margin {{ chart.worst.m >= 0 ? '+' : '' }}{{ chart.worst.m.toFixed(2) }} ({{ (analysis.modeLabels ?? MODES)[chart.worst.mode] ?? chart.worst.mode }}),
        {{ format(chart.worst.d, 'length', defaultUnit(system, 'length')) }} from the root rib (the dot; its line is drawn
        heavier). Margins above +3 are drawn at +3.
      </span>
      <span v-if="chart.breakX.length">
        Dashed verticals on the moment chart are the dihedral breaks. Brace markers (B1, B2...) sit at their margin; a
        triangle means the margin is off scale (drawn at the edge of the chart).
      </span>
      <span v-if="expanded">Scroll over a chart to zoom it (both charts move along the span together), drag to move around, F to see it all.</span>
      <span>Bending counts the spar, sheeting (sheeted hard points' included), any laminate and the stringers; hinge spars, edge stock and servo trays are left out, on the safe side.</span>
    </figcaption>
    <!-- Fixed over the page, inside the app so it keeps its theme -->
    <div v-if="!expanded && big" class="wc-confirm__backdrop" @pointerdown.self="big = false">
      <div class="wc-loads__panel" role="dialog" aria-modal="true" aria-label="Loads along the span">
        <LoadsChart :analysis="analysis" :ribs="ribs" :system="system" :design-g="designG" expanded @close="big = false" />
      </div>
    </div>
  </figure>
</template>
