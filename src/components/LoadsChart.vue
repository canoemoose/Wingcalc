<script setup>
// Along the span from the root rib: bending moment at the design load, and the lowest
// margin of safety at each station (0 is just enough). Rib positions are ticked.
import { computed } from 'vue'
import { MODES } from '../lib/structure.js'
import { format, defaultUnit } from '../lib/units.js'

const props = defineProps({
  analysis: { type: Object, required: true },
  ribs: { type: Array, required: true }, // parts of group 'ribs'
  system: { type: String, required: true },
  designG: { type: Number, required: true },
})

const W = 520
const H = 130
const M = { l: 44, r: 10, t: 12, b: 22 }
const MS_MAX = 3
const MS_MIN = -1

const chart = computed(() => {
  const st = props.analysis.stations
  const span = props.analysis.tipS - props.analysis.rootS
  const x = (d) => M.l + (d / span) * (W - M.l - M.r)
  const mMax = Math.max(...st.map((r) => Math.max(r.M, r.Mneg ?? 0)), 1e-6)
  const yM = (v) => H - M.b - (v / mMax) * (H - M.t - M.b)
  const yS = (v) => H - M.b - ((Math.min(MS_MAX, Math.max(MS_MIN, v)) - MS_MIN) / (MS_MAX - MS_MIN)) * (H - M.t - M.b)
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
  const worst = msPts.reduce((w, p) => (!w || p.m < w.m ? p : w), null)
  const lengthUnit = defaultUnit(props.system, 'length')
  return {
    x,
    moment: st.map((r) => `${x(r.d).toFixed(1)},${yM(r.M).toFixed(1)}`).join(' '),
    momentNeg: st.some((r) => r.Mneg > 0) ? st.map((r) => `${x(r.d).toFixed(1)},${yM(r.Mneg).toFixed(1)}`).join(' ') : null,
    mMax,
    yM,
    margin: msPts.map((p) => `${x(p.d).toFixed(1)},${yS(p.m).toFixed(1)}`).join(' '),
    zero: yS(0),
    yS,
    worst,
    ribX: props.ribs.map((p) => x(p.s - props.analysis.rootS)),
    spanLabel: format(span, 'length', lengthUnit),
  }
})
const nm = (v) => `${v.toFixed(v < 10 ? 2 : 1)} N·m`
</script>

<template>
  <figure class="wc-figure wc-loads">
    <svg :viewBox="`0 0 ${W} ${H}`" role="img" aria-label="Bending moment along the span">
      <line v-for="(x, i) in chart.ribX" :key="'r' + i" :x1="x" :x2="x" :y1="M.t" :y2="H - M.b" class="wc-loads__rib" />
      <line :x1="M.l" :x2="W - M.r" :y1="H - M.b" :y2="H - M.b" class="wc-svg-axis" />
      <polyline v-if="chart.momentNeg" :points="chart.momentNeg" class="wc-svg-curve wc-svg-curve--indicative" />
      <polyline :points="chart.moment" class="wc-svg-curve" />
      <text :x="M.l - 4" :y="M.t + 4" text-anchor="end" class="wc-svg-tick">{{ chart.mMax.toFixed(1) }}</text>
      <text :x="M.l - 4" :y="H - M.b" text-anchor="end" class="wc-svg-tick">0</text>
      <text :x="M.l + 4" :y="M.t + 4" class="wc-svg-tick">Bending moment, N·m</text>
      <text :x="M.l" :y="H - 6" class="wc-svg-tick">root rib</text>
      <text :x="W - M.r" :y="H - 6" text-anchor="end" class="wc-svg-tick">tip, {{ chart.spanLabel }}</text>
    </svg>
    <svg :viewBox="`0 0 ${W} ${H}`" role="img" aria-label="Lowest margin of safety along the span">
      <rect :x="M.l" :y="chart.zero" :width="W - M.l - M.r" :height="H - M.b - chart.zero" class="wc-loads__bad" />
      <line v-for="(x, i) in chart.ribX" :key="'r' + i" :x1="x" :x2="x" :y1="M.t" :y2="H - M.b" class="wc-loads__rib" />
      <line :x1="M.l" :x2="W - M.r" :y1="chart.zero" :y2="chart.zero" class="wc-svg-axis" />
      <polyline :points="chart.margin" class="wc-svg-curve" />
      <circle v-if="chart.worst" :cx="chart.x(chart.worst.d)" :cy="chart.yS(chart.worst.m)" r="3.5" class="wc-svg-peak" />
      <text :x="M.l - 4" :y="chart.yS(MS_MAX) + 4" text-anchor="end" class="wc-svg-tick">+{{ MS_MAX }}</text>
      <text :x="M.l - 4" :y="chart.zero + 3" text-anchor="end" class="wc-svg-tick">0</text>
      <text :x="M.l - 4" :y="chart.yS(MS_MIN)" text-anchor="end" class="wc-svg-tick">{{ MS_MIN }}</text>
      <text :x="M.l + 4" :y="M.t + 4" class="wc-svg-tick">Lowest margin of safety</text>
    </svg>
    <figcaption class="wc-figure__caption">
      <span>
        Root bending {{ nm(analysis.rootMoment) }} and shear {{ analysis.rootShear.toFixed(0) }} N at
        {{ designG }} g (solid; dashed is the negative case). Ribs are the vertical ticks.
      </span>
      <span v-if="chart.worst">
        Lowest margin {{ chart.worst.m >= 0 ? '+' : '' }}{{ chart.worst.m.toFixed(2) }} ({{ MODES[chart.worst.mode] ?? chart.worst.mode }}),
        {{ format(chart.worst.d, 'length', defaultUnit(system, 'length')) }} from the root rib. Margins above +3 are drawn
        at +3.
      </span>
    </figcaption>
  </figure>
</template>
