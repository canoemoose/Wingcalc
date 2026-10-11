<script setup>
// Top and front views of the full wing, drawn to scale. The top view is the projected
// outline (as seen from above); the front view shows dihedral and polyhedral at their true
// angles. In panel mode the plan editor shows the top view, so only the front is drawn.
import { computed } from 'vue'
import { format } from '../lib/units.js'

const props = defineProps({
  geometry: { type: Object, required: true },
  lengthUnit: { type: String, required: true },
  showTop: { type: Boolean, default: true },
})

const top = computed(() => {
  const g = props.geometry
  if (!props.showTop || !g.outline || !(g.span > 0)) return null
  const h = g.span / 2
  const right = g.outline
  const left = right.map(([y, x]) => [-y, x]).reverse()
  const xs = right.map(([, x]) => x)
  const xMin = Math.min(...xs)
  const xMax = Math.max(...xs)
  const depth = xMax - xMin
  const padX = g.span * 0.04
  const padY = depth * 0.35
  const breaks = [
    ...(g.fuselageHalf > 0 ? [{ y: g.fuselageHalf, xl: 0, xt: g.rootChord }] : []),
    ...(g.breaks ?? []),
  ].flatMap((b) => [b, { ...b, y: -b.y }])
  const mac = g.mac ?? g.meanChord
  const macX = g.macX ?? 0
  return {
    points: [...right, ...left].map(([y, x]) => `${y},${x}`).join(' '),
    breaks,
    mac: { y: g.macY ?? h / 2, top: macX, bottom: macX + mac },
    viewBox: `${-h - padX} ${xMin - padY} ${g.span + 2 * padX} ${depth + 2 * padY}`,
    font: Math.max(g.span, depth * 4) * 0.028,
    labelY: xMax + padY * 0.75,
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
      <line v-for="(b, i) in top.breaks" :key="i" :x1="b.y" :y1="b.xl" :x2="b.y" :y2="b.xt" class="wc-svg-break" />
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
    <p v-if="showTop && !top" class="wc-muted">Enter span and chord (or area) to draw the planform.</p>
    <figcaption v-if="top || front" class="wc-figure__caption">
      <span>
        <template v-if="top">
          Top view as seen from above: panel breaks thin, mean aerodynamic chord marked in accent colour.
          <template v-if="!geometry.tipChord">Drawn as a constant-chord wing.</template>
        </template>
        <template v-if="front">Front view at true dihedral angles.</template>
      </span>
    </figcaption>
  </figure>
</template>
