<script setup>
// Lift curve (Cl against alpha): the XFOIL polar used for the stall rating (computed in the
// browser, or bundled from airfoiltools.com until that's ready), or, for sections without a
// polar, an indicative curve drawn from the rating (dashed). Computed polars leave gaps
// where XFOIL did not converge.
import { computed } from 'vue'

const props = defineProps({
  // { alpha: [], cl: [], re, peak: { alpha, cl }, indicative, computed?, segments?: [[i0, i1], ...],
  //   reference?: { alpha: [], cl: [], re } } (airfoiltools.com polar, drawn faintly when it differs)
  curve: { type: Object, required: true },
})

const W = 320
const H = 180
const M = { l: 34, r: 10, t: 10, b: 28 }

const chart = computed(() => {
  const { alpha, cl, peak, reference: ref } = props.curve
  const allA = ref ? [...alpha, ...ref.alpha] : alpha
  const allC = ref ? [...cl, ...ref.cl] : cl
  const aMin = Math.floor(Math.min(...allA) / 5) * 5
  const aMax = Math.ceil(Math.max(...allA) / 5) * 5
  const cMin = Math.min(0, Math.floor(Math.min(...allC) * 2) / 2)
  const cMax = Math.ceil(Math.max(...allC) * 2) / 2
  const x = (a) => M.l + ((a - aMin) / (aMax - aMin)) * (W - M.l - M.r)
  const y = (c) => H - M.b - ((c - cMin) / (cMax - cMin)) * (H - M.t - M.b)
  const xTicks = []
  for (let a = aMin; a <= aMax; a += 5) xTicks.push({ v: a, p: x(a) })
  const yTicks = []
  for (let c = cMin; c <= cMax + 1e-9; c += 0.5) yTicks.push({ v: c, p: y(c) })
  return {
    lines: (props.curve.segments ?? [[0, alpha.length - 1]]).map(([i0, i1]) =>
      alpha
        .slice(i0, i1 + 1)
        .map((a, k) => `${x(a).toFixed(1)},${y(cl[i0 + k]).toFixed(1)}`)
        .join(' '),
    ),
    reference: ref ? ref.alpha.map((a, i) => `${x(a).toFixed(1)},${y(ref.cl[i]).toFixed(1)}`).join(' ') : null,
    peak: { x: x(peak.alpha), y: y(peak.cl) },
    band: { x: x(peak.alpha), w: x(Math.min(peak.alpha + 2, aMax)) - x(peak.alpha) },
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
      <polyline v-if="chart.reference" :points="chart.reference" class="wc-svg-curve wc-svg-curve--reference" />
      <polyline
        v-for="(line, i) in chart.lines"
        :key="i"
        :points="line"
        class="wc-svg-curve"
        :class="{ 'wc-svg-curve--indicative': curve.indicative }"
      />
      <circle :cx="chart.peak.x" :cy="chart.peak.y" r="3.5" class="wc-svg-peak" />
      <text :x="chart.x1" :y="chart.y0 + 24" text-anchor="end" class="wc-svg-tick">angle of attack</text>
      <text :x="4" :y="chart.y1 + 4" class="wc-svg-tick">Cl</text>
    </svg>
    <figcaption class="wc-figure__caption">
      <template v-if="curve.indicative">
        Indicative curve, not computed data: drawn from the stall rating, the section's Clmax and its zero-lift
        angle, to show what the rating means. Dot marks max lift; the shaded band is the 2° past it.
      </template>
      <template v-else-if="curve.computed">
        XFOIL lift curve at Re {{ curve.re.toLocaleString('en-GB') }}, computed in your browser.<template
          v-if="curve.segments && curve.segments.length > 1"
        >
          Gaps are angles where XFOIL did not converge.</template
        >
        Dot marks max lift; the shaded band is the 2° past it used for the rating.<template v-if="curve.reference">
          The faint dashed line is the airfoiltools.com polar at Re {{ curve.reference.re.toLocaleString('en-GB') }}, for
          comparison.</template
        >
      </template>
      <template v-else>
        XFOIL lift curve at Re {{ curve.re.toLocaleString('en-GB') }} (airfoiltools.com). Dot marks max lift; the
        shaded band is the 2° past it used for the rating.
      </template>
    </figcaption>
  </figure>
</template>
