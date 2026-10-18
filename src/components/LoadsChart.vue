<script setup>
// Along the span from the root rib: bending moment at the design load, and the margin of
// safety for each failure mode at each station (0 is just enough), with a legend; the
// lowest is marked. Rib positions are ticked. Hovering either chart draws a line across both
// at that span position and reads every curve there. The corner button opens the same charts
// to fill the window, over the page (the component again, expanded, its charts drawn at the
// size they're shown so the text stays its usual size); Escape, Close or the backdrop closes it.
// Each chart has its title and key above it and its own readout under it; both charts are drawn
// at the size they're shown, so their text is the same size in the card and expanded.
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { MODES, MODE_SLOTS } from '../lib/structure.js'
import { format, defaultUnit } from '../lib/units.js'
import { EXPAND, SHRINK } from '../lib/icons.js'
import LoadsChart from './LoadsChart.vue'

const props = defineProps({
  analysis: { type: Object, required: true },
  ribs: { type: Array, required: true }, // parts of group 'ribs'
  system: { type: [String, Object], required: true }, // a units setting (units.js normaliseUnits) or system name
  designG: { type: Number, required: true },
  // Drawn larger, in the overlay
  expanded: { type: Boolean, default: false },
})
const emit = defineEmits(['close'])

// Drawn at the width they're shown, in px. In the card each chart is a fixed height; expanded,
// each takes half of what the stage has (its titles and readouts aside), so they fill it
const stageEl = ref(null)
const stage = ref({ w: 520, h: 560 })
const W = computed(() => Math.max(300, stage.value.w))
const H = computed(() => (props.expanded ? Math.max(160, Math.floor(stage.value.h / 2) - 2) : 140))
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
      if (c.tagName.toLowerCase() === 'svg') continue
      const cs = getComputedStyle(c)
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

const chart = computed(() => {
  const st = props.analysis.stations
  const span = props.analysis.tipS - props.analysis.rootS
  const W_ = W.value
  const H_ = H.value
  const x = (d) => M.l + (d / span) * (W_ - M.l - M.r)
  const mMax = Math.max(...st.map((r) => Math.max(r.M, r.Mneg ?? 0)), 1e-6)
  const yM = (v) => H_ - M.b - (v / mMax) * (H_ - M.t - M.b)
  const yS = (v) => H_ - M.b - ((Math.min(MS_MAX, Math.max(MS_MIN, v)) - MS_MIN) / (MS_MAX - MS_MIN)) * (H_ - M.t - M.b)
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
      return { name: b.name, x: x(b.s - rootS), y: yS(b.margin), margin: b.margin, off }
    })
  return {
    x,
    braces,
    breakX: (props.analysis.braces ?? []).filter((b) => b.ok).map((b) => x(b.s - rootS)),
    moment: st.map((r) => `${x(r.d).toFixed(1)},${yM(r.M).toFixed(1)}`).join(' '),
    momentNeg: st.some((r) => r.Mneg > 0) ? st.map((r) => `${x(r.d).toFixed(1)},${yM(r.Mneg).toFixed(1)}`).join(' ') : null,
    mMax,
    yM,
    modes,
    zero: yS(0),
    yS,
    worst,
    ribX: props.ribs.map((p) => x(p.s - props.analysis.rootS)),
    spanLabel: format(span, 'length', lengthUnit),
    span,
  }
})

// The crosshair: the span position under the pointer, and every curve's value there
const hoverD = ref(null)
function onHover(e) {
  const r = e.currentTarget.getBoundingClientRect()
  if (!(r.width > 0)) return
  const vx = ((e.clientX - r.left) / r.width) * W.value
  const f = (vx - M.l) / (W.value - M.l - M.r)
  hoverD.value = f < 0 || f > 1 ? null : f * chart.value.span
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
  const at = (get, show) => {
    if (d == null) return ''
    const v = valueAt(get, d)
    return v == null ? '' : show(v)
  }
  const bending = [{ key: 'M', line: 'solid', label: `at ${props.designG} g`, value: at((r) => r.M, nm) }]
  if (hasNeg.value) bending.push({ key: 'Mn', line: 'dashed', label: 'negative', value: at((r) => r.Mneg, nm) })
  const margins = chart.value.modes.map((m) => ({ key: m.key, slot: m.slot, label: m.label, value: at((r) => r.ms[m.key], signed) }))
  return { x: d == null ? null : chart.value.x(d), at: d == null ? null : format(d, 'length', defaultUnit(props.system, 'length')), bending, margins }
})

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
    <svg :viewBox="`0 0 ${W} ${H}`" :width="W" :height="H" role="img" aria-label="Bending moment along the span" @pointermove="onHover" @pointerleave="hoverD = null">
      <line v-for="(x, i) in chart.ribX" :key="'r' + i" :x1="x" :x2="x" :y1="M.t" :y2="H - M.b" class="wc-loads__rib" />
      <line :x1="M.l" :x2="W - M.r" :y1="H - M.b" :y2="H - M.b" class="wc-svg-axis" />
      <polyline v-if="chart.momentNeg" :points="chart.momentNeg" class="wc-svg-curve wc-svg-curve--indicative" />
      <polyline :points="chart.moment" class="wc-svg-curve" />
      <line v-for="(x, i) in chart.breakX" :key="'b' + i" :x1="x" :x2="x" :y1="M.t" :y2="H - M.b" class="wc-loads__break" />
      <text :x="M.l - 4" :y="M.t + 4" text-anchor="end" class="wc-svg-tick">{{ chart.mMax.toFixed(1) }}</text>
      <text :x="M.l - 4" :y="H - M.b" text-anchor="end" class="wc-svg-tick">0</text>
      <text :x="M.l" :y="H - 6" class="wc-svg-tick">root rib</text>
      <text :x="W - M.r" :y="H - 6" text-anchor="end" class="wc-svg-tick">tip, {{ chart.spanLabel }}</text>
      <line v-if="readout.x != null" :x1="readout.x" :x2="readout.x" :y1="M.t" :y2="H - M.b" class="wc-loads__cross" />
    </svg>
    <p class="wc-loads__readout" aria-live="polite">
      <span class="wc-loads__at">
        <template v-if="readout.at"><strong>{{ readout.at }}</strong> from the root rib:</template>
        <span v-else class="wc-muted">Point at a chart to read it here:</span>
      </span>
      <span v-for="it in readout.bending" :key="it.key" class="wc-loads__reading">
        <span :class="['wc-loads__line', { 'wc-loads__line--dashed': it.line === 'dashed' }]" aria-hidden="true"></span>{{ it.label }}
        <span class="wc-loads__value">{{ it.value }}</span>
      </span>
    </p>
    <div class="wc-loads__head"><span class="wc-loads__title">Margin of safety by failure mode</span></div>
    <svg :viewBox="`0 0 ${W} ${H}`" :width="W" :height="H" role="img" aria-label="Lowest margin of safety along the span" @pointermove="onHover" @pointerleave="hoverD = null">
      <rect :x="M.l" :y="chart.zero" :width="W - M.l - M.r" :height="H - M.b - chart.zero" class="wc-loads__bad" />
      <line v-for="(x, i) in chart.ribX" :key="'r' + i" :x1="x" :x2="x" :y1="M.t" :y2="H - M.b" class="wc-loads__rib" />
      <line :x1="M.l" :x2="W - M.r" :y1="chart.zero" :y2="chart.zero" class="wc-svg-axis" />
      <polyline
        v-for="m in chart.modes"
        :key="m.key"
        :points="m.points"
        :class="['wc-loads__mode', `wc-loads__mode--${m.slot}`, { 'wc-loads__mode--worst': m.key === chart.worst?.mode }]"
      >
        <title>{{ m.label }}: lowest {{ m.low >= 0 ? '+' : '' }}{{ m.low.toFixed(2) }}</title>
      </polyline>
      <circle v-if="chart.worst" :cx="chart.x(chart.worst.d)" :cy="chart.yS(chart.worst.m)" r="3.5" class="wc-svg-peak" />
      <g v-for="b in chart.braces" :key="'brace' + b.name">
        <title>{{ b.name }}: margin {{ b.margin >= 0 ? '+' : '' }}{{ b.margin.toFixed(2) }}{{ b.off ? ` (off scale, ${b.off} the chart)` : '' }}</title>
        <circle :cx="b.x" :cy="b.y" r="3" class="wc-loads__brace" />
        <text :x="b.x" :y="b.y - 6" text-anchor="middle" class="wc-svg-tick">{{ b.name }}{{ b.off === 'above' ? ' ▲' : b.off === 'below' ? ' ▼' : '' }}</text>
      </g>
      <text :x="M.l - 4" :y="chart.yS(MS_MAX) + 4" text-anchor="end" class="wc-svg-tick">+{{ MS_MAX }}</text>
      <text :x="M.l - 4" :y="chart.zero + 3" text-anchor="end" class="wc-svg-tick">0</text>
      <text :x="M.l - 4" :y="chart.yS(MS_MIN)" text-anchor="end" class="wc-svg-tick">{{ MS_MIN }}</text>
      <line v-if="readout.x != null" :x1="readout.x" :x2="readout.x" :y1="M.t" :y2="H - M.b" class="wc-loads__cross" />
    </svg>
    <p class="wc-loads__readout" aria-live="polite">
      <span class="wc-loads__at">
        <template v-if="readout.at"><strong>{{ readout.at }}</strong> from the root rib:</template>
        <span v-else class="wc-muted">Point at a chart to read it here:</span>
      </span>
      <span v-for="it in readout.margins" :key="it.key" class="wc-loads__reading">
        <span :class="['wc-loads__swatch', `wc-loads__mode--${it.slot}`]" aria-hidden="true"></span>{{ it.label }}
        <span class="wc-loads__value">{{ it.value }}</span>
      </span>
    </p>
    </div>
    <ul class="wc-loads__legend" aria-label="Lowest margin along the span, by failure mode">
      <li class="wc-loads__legend-head">Lowest along the span:</li>
      <li v-for="m in chart.modes" :key="m.key" :class="{ 'wc-loads__legend--worst': m.key === chart.worst?.mode }">
        <span :class="['wc-loads__swatch', `wc-loads__mode--${m.slot}`]" aria-hidden="true"></span>
        {{ m.label }} <span class="wc-muted">{{ m.low >= 0 ? '+' : '' }}{{ m.low.toFixed(2) }}</span>
      </li>
      <li v-if="chart.braces.length || chart.breakX.length">
        <span class="wc-loads__swatch wc-loads__swatch--brace" aria-hidden="true"></span>
        Dihedral brace <span class="wc-muted">B1 to B{{ chart.braces.length || chart.breakX.length }}</span>
      </li>
    </ul>
    <figcaption class="wc-figure__caption">
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
      <span>Bending counts the spar, sheeting, any laminate and the stringers; hinge spars, edge stock, servo trays and hard points are left out, on the safe side.</span>
    </figcaption>
    <!-- Fixed over the page, inside the app so it keeps its theme -->
    <div v-if="!expanded && big" class="wc-confirm__backdrop" @pointerdown.self="big = false">
      <div class="wc-loads__panel" role="dialog" aria-modal="true" aria-label="Loads along the span">
        <LoadsChart :analysis="analysis" :ribs="ribs" :system="system" :design-g="designG" expanded @close="big = false" />
      </div>
    </div>
  </figure>
</template>
