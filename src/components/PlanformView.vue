<script setup>
// Top and front views of the full wing, drawn to scale from the geometry's spanwise
// stations, with an unswept quarter-chord line. The front view shows dihedral and
// polyhedral at their true angles.
import { computed } from 'vue'
import { format } from '../lib/units.js'

const props = defineProps({
  geometry: { type: Object, required: true },
  lengthUnit: { type: String, required: true },
})

const top = computed(() => {
  const g = props.geometry
  const st = g.stations
  if (!st || !(g.span > 0)) return null
  const h = g.span / 2
  // Right half LE root -> tip, then TE tip -> root; mirror for the left half.
  const right = [...st.map((s) => [s.y, -0.25 * s.c]), ...[...st].reverse().map((s) => [s.y, 0.75 * s.c])]
  const left = right.map(([x, y]) => [-x, y]).reverse()
  const outline = [...right, ...left]
  const maxC = Math.max(...st.map((s) => s.c))
  const padX = g.span * 0.04
  const padY = maxC * 0.35
  const breaks = st.slice(1, -1).flatMap((s) => [
    { x: s.y, y1: -0.25 * s.c, y2: 0.75 * s.c },
    { x: -s.y, y1: -0.25 * s.c, y2: 0.75 * s.c },
  ])
  const mac = g.mac ?? g.meanChord
  return {
    points: outline.map(([x, y]) => `${x},${y}`).join(' '),
    breaks,
    mac: { y: g.macY ?? h / 2, top: -0.25 * mac, bottom: 0.75 * mac },
    viewBox: `${-h - padX} ${-0.25 * maxC - padY} ${g.span + 2 * padX} ${maxC + 2 * padY}`,
    font: Math.max(g.span, maxC * 4) * 0.028,
    labelY: 0.75 * maxC + padY * 0.75,
    h,
  }
})

const front = computed(() => {
  const g = props.geometry
  const st = g.stations
  if (!st || !(g.span > 0) || !g.hasDihedral) return null
  const right = st.map((s) => [s.y, -s.z])
  const pts = [...[...right].reverse().map(([x, y]) => [-x, y]), ...right.slice(1)]
  const zs = st.map((s) => -s.z)
  const top = Math.min(0, ...zs)
  const bottom = Math.max(0, ...zs)
  const font = g.span * 0.028
  const pad = g.span * 0.04
  const minH = g.span * 0.12
  const height = Math.max(minH, bottom - top + 2 * pad + font * 1.5)
  const mid = (top + bottom) / 2
  const labels = st.slice(1).map((s, i) => {
    const prev = st[i]
    const angle = (Math.atan2(s.z - prev.z, s.y - prev.y) * 180) / Math.PI
    return { x: (s.y + prev.y) / 2, y: -(s.z + prev.z) / 2 + font * 1.3, text: `${angle.toFixed(1)}°` }
  })
  return {
    points: pts.map(([x, y]) => `${x},${y}`).join(' '),
    viewBox: `${-g.span / 2 - pad} ${mid - height / 2} ${g.span + 2 * pad} ${height}`,
    labels,
    font,
    h: g.span / 2,
  }
})
</script>

<template>
  <figure class="wc-figure">
    <svg
      v-if="top"
      class="wc-planform"
      :viewBox="top.viewBox"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Wing planform, top view"
    >
      <polygon :points="top.points" class="wc-svg-outline" />
      <line :x1="-top.h" y1="0" :x2="top.h" y2="0" class="wc-svg-chord" />
      <line v-for="(b, i) in top.breaks" :key="i" :x1="b.x" :y1="b.y1" :x2="b.x" :y2="b.y2" class="wc-svg-break" />
      <line :x1="top.mac.y" :y1="top.mac.top" :x2="top.mac.y" :y2="top.mac.bottom" class="wc-svg-mac" />
      <line :x1="-top.mac.y" :y1="top.mac.top" :x2="-top.mac.y" :y2="top.mac.bottom" class="wc-svg-mac" />
      <text x="0" :y="top.labelY" :font-size="top.font" text-anchor="middle" class="wc-svg-text">
        Span {{ format(geometry.span, 'length', lengthUnit) }}
      </text>
    </svg>
    <svg
      v-if="front"
      class="wc-frontview"
      :viewBox="front.viewBox"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Wing front view showing dihedral"
    >
      <line :x1="-front.h" y1="0" :x2="front.h" y2="0" class="wc-svg-chord" />
      <polyline :points="front.points" class="wc-svg-spar" />
      <text
        v-for="(l, i) in front.labels"
        :key="i"
        :x="l.x"
        :y="l.y"
        :font-size="front.font"
        text-anchor="middle"
        class="wc-svg-text"
      >
        {{ l.text }}
      </text>
    </svg>
    <p v-if="!top" class="wc-muted">Enter span and chord (or area) to draw the planform.</p>
    <figcaption v-if="top" class="wc-figure__caption">
      <span>
        Top view: quarter-chord line dashed, panel breaks thin, mean aerodynamic chord marked in accent colour.
        <template v-if="front">Front view below at true angles.</template>
        <template v-if="geometry.stations && geometry.stations.length === 2 && !geometry.tipChord">
          Drawn as a constant-chord wing.</template
        >
      </span>
    </figcaption>
  </figure>
</template>
