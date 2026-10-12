<script setup>
// Spanwise lift at the stall, from the lifting line: each station's local Cl against its
// own section Clmax, root to tip. Where the two lines first touch is where the wing stalls.
import { computed } from 'vue'

const props = defineProps({
  // [{ eta, cl, clMax }] root to tip, and the stall onset as a fraction of the semi-span
  distribution: { type: Array, required: true },
  onsetEta: { type: Number, required: true },
})

const W = 320
const H = 160
const M = { l: 34, r: 10, t: 10, b: 28 }

const chart = computed(() => {
  const pts = props.distribution.filter((d) => Number.isFinite(d.cl) && Number.isFinite(d.clMax))
  const hi = Math.ceil(Math.max(...pts.map((d) => Math.max(d.cl, d.clMax))) * 2) / 2
  const x = (e) => M.l + e * (W - M.l - M.r)
  const y = (c) => H - M.b - (Math.max(0, c) / hi) * (H - M.t - M.b)
  const line = (key) => pts.map((d) => `${x(d.eta).toFixed(1)},${y(d[key]).toFixed(1)}`).join(' ')
  const onset = pts.reduce((a, b) => (Math.abs(b.eta - props.onsetEta) < Math.abs(a.eta - props.onsetEta) ? b : a))
  const yTicks = []
  for (let c = 0; c <= hi + 1e-9; c += 0.5) yTicks.push({ v: c, p: y(c) })
  const xTicks = [0, 0.25, 0.5, 0.75, 1].map((e) => ({ v: `${e * 100}%`, p: x(e) }))
  return {
    cl: line('cl'),
    clMax: line('clMax'),
    onset: { x: x(onset.eta), y: y(onset.cl) },
    yTicks,
    xTicks,
    x0: M.l,
    x1: W - M.r,
    y0: H - M.b,
    y1: M.t,
  }
})
</script>

<template>
  <figure class="wc-figure">
    <svg class="wc-lift" :viewBox="`0 0 ${W} ${H}`" role="img" aria-label="Spanwise lift at the stall">
      <g v-for="t in chart.yTicks" :key="'y' + t.v">
        <line :x1="chart.x0" :x2="chart.x1" :y1="t.p" :y2="t.p" class="wc-svg-grid" />
        <text :x="chart.x0 - 4" :y="t.p + 3" text-anchor="end" class="wc-svg-tick">{{ t.v.toFixed(1) }}</text>
      </g>
      <text v-for="t in chart.xTicks" :key="'x' + t.v" :x="t.p" :y="chart.y0 + 12" text-anchor="middle" class="wc-svg-tick">
        {{ t.v }}
      </text>
      <line :x1="chart.x0" :x2="chart.x1" :y1="chart.y0" :y2="chart.y0" class="wc-svg-axis" />
      <polyline :points="chart.clMax" class="wc-svg-curve wc-svg-curve--indicative" />
      <polyline :points="chart.cl" class="wc-svg-curve" />
      <circle :cx="chart.onset.x" :cy="chart.onset.y" r="3.5" class="wc-svg-peak" />
      <text :x="chart.x1" :y="chart.y0 + 24" text-anchor="end" class="wc-svg-tick">root to tip (semi-span)</text>
      <text :x="4" :y="chart.y1 + 4" class="wc-svg-tick">Cl</text>
    </svg>
    <figcaption class="wc-figure__caption">
      Spanwise lift at the stall (lifting line): solid is each station's local Cl, dashed the Clmax its own section
      can reach at its own Reynolds number. The dot is where it stalls first.
    </figcaption>
  </figure>
</template>
