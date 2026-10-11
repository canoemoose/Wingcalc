<script setup>
// Lift curve (Cl against alpha) for the polar used in the stall-character rating.
import { computed } from 'vue'

const props = defineProps({
  polar: { type: Object, required: true },
  stall: { type: Object, required: true },
})

const W = 320
const H = 180
const M = { l: 34, r: 10, t: 10, b: 28 }

const chart = computed(() => {
  const { alpha, cl } = props.polar
  const aMin = Math.floor(Math.min(...alpha) / 5) * 5
  const aMax = Math.ceil(Math.max(...alpha) / 5) * 5
  const cMin = Math.min(0, Math.floor(Math.min(...cl) * 2) / 2)
  const cMax = Math.ceil(Math.max(...cl) * 2) / 2
  const x = (a) => M.l + ((a - aMin) / (aMax - aMin)) * (W - M.l - M.r)
  const y = (c) => H - M.b - ((c - cMin) / (cMax - cMin)) * (H - M.t - M.b)
  const xTicks = []
  for (let a = aMin; a <= aMax; a += 5) xTicks.push({ v: a, p: x(a) })
  const yTicks = []
  for (let c = cMin; c <= cMax + 1e-9; c += 0.5) yTicks.push({ v: c, p: y(c) })
  const s = props.stall
  return {
    line: alpha.map((a, i) => `${x(a).toFixed(1)},${y(cl[i]).toFixed(1)}`).join(' '),
    peak: { x: x(s.alphaClMax), y: y(s.clMax) },
    band: { x: x(s.alphaClMax), w: x(Math.min(s.alphaClMax + 2, aMax)) - x(s.alphaClMax) },
    xTicks,
    yTicks,
    x0: M.l,
    x1: W - M.r,
    y0: H - M.b,
    y1: M.t,
  }
})
</script>

<template>
  <figure class="wc-figure">
    <svg class="wc-lift" :viewBox="`0 0 ${W} ${H}`" role="img" aria-label="Lift curve">
      <rect :x="chart.band.x" :y="chart.y1" :width="chart.band.w" :height="chart.y0 - chart.y1" class="wc-svg-band" />
      <g v-for="t in chart.yTicks" :key="'y' + t.v">
        <line :x1="chart.x0" :x2="chart.x1" :y1="t.p" :y2="t.p" class="wc-svg-grid" />
        <text :x="chart.x0 - 4" :y="t.p + 3" text-anchor="end" class="wc-svg-tick">{{ t.v.toFixed(1) }}</text>
      </g>
      <g v-for="t in chart.xTicks" :key="'x' + t.v">
        <text :x="t.p" :y="chart.y0 + 12" text-anchor="middle" class="wc-svg-tick">{{ t.v }}°</text>
      </g>
      <line :x1="chart.x0" :x2="chart.x1" :y1="chart.y0" :y2="chart.y0" class="wc-svg-axis" />
      <polyline :points="chart.line" class="wc-svg-curve" />
      <circle :cx="chart.peak.x" :cy="chart.peak.y" r="3.5" class="wc-svg-peak" />
      <text :x="chart.x1" :y="chart.y0 + 24" text-anchor="end" class="wc-svg-tick">angle of attack</text>
      <text :x="4" :y="chart.y1 + 4" class="wc-svg-tick">Cl</text>
    </svg>
    <figcaption class="wc-figure__caption">
      XFOIL lift curve at Re {{ polar.re.toLocaleString('en-GB') }}. Dot marks max lift; the shaded band is the 2°
      past it used for the rating.
    </figcaption>
  </figure>
</template>
