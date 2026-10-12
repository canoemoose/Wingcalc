<script setup>
// True-proportion drawing of an aerofoil section with chord line, mean line and
// leading-edge circle, for checking the input by eye. When the wing's thickness tapers, the
// tip section is drawn over it, dashed.
import { computed } from 'vue'
import { splitSurfaces, interp } from '../lib/airfoilGeom.js'

const props = defineProps({
  coords: { type: Array, required: true },
  params: { type: Object, default: null }, // fractions of chord, as resolveAirfoil returns
  name: { type: String, default: '' },
  valid: { type: Boolean, default: true },
  invalidNote: { type: String, default: 'These parameters give an impossible shape; adjust them.' },
  tipCoords: { type: Array, default: null },
  tipNote: { type: String, default: '' },
})

const PAD = 0.03

const bounds = computed(() => {
  let lo = -0.08
  let hi = 0.12
  for (const [, y] of props.coords) {
    lo = Math.min(lo, y)
    hi = Math.max(hi, y)
  }
  return { lo: lo - PAD, hi: hi + PAD }
})

// SVG y runs downwards, so flip y.
const viewBox = computed(() => {
  const { lo, hi } = bounds.value
  return `${-PAD} ${-hi} ${1 + 2 * PAD} ${hi - lo}`
})

const toPoints = (coords) => coords.map(([x, y]) => `${x.toFixed(5)},${(-y).toFixed(5)}`).join(' ')
const outline = computed(() => toPoints(props.coords))
const tipOutline = computed(() => (props.tipCoords ? toPoints(props.tipCoords) : null))

const meanLine = computed(() => {
  const { upper, lower } = splitSurfaces(props.coords)
  const pts = []
  for (let i = 0; i <= 50; i++) {
    const x = 0.5 * (1 - Math.cos((Math.PI * i) / 50))
    pts.push(`${x.toFixed(5)},${(-(interp(upper, x) + interp(lower, x)) / 2).toFixed(5)}`)
  }
  return pts.join(' ')
})

const leCircle = computed(() => {
  const p = props.params
  if (!p?.leRadius) return null
  const slope = p.camber > 0 && p.camberPos > 0 ? (2 * p.camber) / p.camberPos : 0
  const th = Math.atan(slope)
  return { cx: p.leRadius * Math.cos(th), cy: -p.leRadius * Math.sin(th), r: p.leRadius }
})

const pct = (v, dp = 1) => (v === null || v === undefined ? '–' : `${(v * 100).toFixed(dp)}%`)
</script>

<template>
  <figure class="wc-figure">
    <svg
      class="wc-section"
      :viewBox="viewBox"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      :aria-label="`Section drawing of ${name}`"
    >
      <line x1="0" y1="0" x2="1" y2="0" class="wc-svg-chord" />
      <polyline :points="meanLine" class="wc-svg-mean" />
      <circle v-if="leCircle" :cx="leCircle.cx" :cy="leCircle.cy" :r="leCircle.r" class="wc-svg-le" />
      <polygon :points="outline" class="wc-svg-outline" :class="{ 'wc-svg-outline--bad': !valid }" />
      <polygon v-if="tipOutline" :points="tipOutline" class="wc-svg-tipsection" />
    </svg>
    <figcaption class="wc-figure__caption">
      <strong>{{ name }}</strong>
      <span v-if="params">
        Thickness {{ pct(params.thickness) }} at {{ pct(params.thicknessPos, 0) }} · Camber
        {{ pct(params.camber) }} at {{ pct(params.camberPos, 0) }} · LE radius {{ pct(params.leRadius, 2) }}
      </span>
      <span v-if="tipNote">{{ tipNote }}</span>
      <span v-if="!valid" class="wc-text-warn">{{ invalidNote }}</span>
    </figcaption>
  </figure>
</template>
