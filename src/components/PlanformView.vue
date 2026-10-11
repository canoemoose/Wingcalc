<script setup>
// Top view of the full wing, drawn to scale with an unswept quarter-chord line.
import { computed } from 'vue'
import { format } from '../lib/units.js'

const props = defineProps({
  geometry: { type: Object, required: true },
  lengthUnit: { type: String, required: true },
})

const shape = computed(() => {
  const g = props.geometry
  if (!(g.span > 0) || !(g.meanChord > 0)) return null
  const tapered = g.rootChord > 0 && g.tipChord >= 0
  const cr = tapered ? g.rootChord : g.meanChord
  const ct = tapered ? g.tipChord : g.meanChord
  const h = g.span / 2
  // Quarter-chord line on y = 0; LE above (negative y), TE below.
  const pts = [
    [-h, -0.25 * ct],
    [0, -0.25 * cr],
    [h, -0.25 * ct],
    [h, 0.75 * ct],
    [0, 0.75 * cr],
    [-h, 0.75 * ct],
  ]
  // Spanwise position and length of the mean aerodynamic chord
  const lam = cr > 0 ? ct / cr : 1
  const yMac = (h / 3) * ((1 + 2 * lam) / (1 + lam))
  const mac = g.mac ?? g.meanChord
  const maxC = Math.max(cr, ct)
  const padX = g.span * 0.04
  const padY = maxC * 0.35
  return {
    tapered,
    points: pts.map(([x, y]) => `${x},${y}`).join(' '),
    mac: { y: yMac, top: -0.25 * mac, bottom: 0.75 * mac },
    viewBox: `${-h - padX} ${-0.25 * maxC - padY} ${g.span + 2 * padX} ${maxC + 2 * padY}`,
    font: Math.max(g.span, maxC * 4) * 0.028,
    labelY: 0.75 * maxC + padY * 0.75,
    h,
    cr,
  }
})
</script>

<template>
  <figure class="wc-figure">
    <svg
      v-if="shape"
      class="wc-planform"
      :viewBox="shape.viewBox"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Wing planform drawing"
    >
      <polygon :points="shape.points" class="wc-svg-outline" />
      <line :x1="-shape.h" y1="0" :x2="shape.h" y2="0" class="wc-svg-chord" />
      <line :x1="shape.mac.y" :y1="shape.mac.top" :x2="shape.mac.y" :y2="shape.mac.bottom" class="wc-svg-mac" />
      <line :x1="-shape.mac.y" :y1="shape.mac.top" :x2="-shape.mac.y" :y2="shape.mac.bottom" class="wc-svg-mac" />
      <text x="0" :y="shape.labelY" :font-size="shape.font" text-anchor="middle" class="wc-svg-text">
        Span {{ format(geometry.span, 'length', lengthUnit) }}
      </text>
    </svg>
    <p v-else class="wc-muted">Enter span and chord (or area) to draw the planform.</p>
    <figcaption v-if="shape" class="wc-figure__caption">
      <span>
        Quarter-chord line dashed; mean aerodynamic chord marked in accent colour.
        <template v-if="!shape.tapered">Drawn as a constant-chord wing.</template>
      </span>
    </figcaption>
  </figure>
</template>
