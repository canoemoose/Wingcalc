<script setup>
// How the leading or trailing edge stock fits the wing's section where the fit is tightest, at
// true proportions: the stock as sold (shaded) at its best height, the section over it, and
// in red where they disagree (wood the stock hasn't got, or a rod standing proud).
// drawing comes from analyseStructure().edges[k].drawing (edgeStock.js fitDrawing).
import { computed } from 'vue'
import { format, defaultUnit } from '../lib/units.js'

const props = defineProps({
  drawing: { type: Object, required: true },
  name: { type: String, required: true }, // 'Leading edge', 'Trailing edge'
  round: { type: Boolean, default: false },
  system: { type: [String, Object], required: true },
})

// SVG y runs down, so flip z.
const pts = (list) => list.map(([x, z]) => `${(x * 1000).toFixed(3)},${(-z * 1000).toFixed(3)}`).join(' ')
const view = computed(() => {
  const d = props.drawing
  const all = [...d.upper, ...d.lower, ...d.stock]
  const xs = all.map(([x]) => x * 1000)
  const zs = all.map(([, z]) => -z * 1000)
  const x0 = Math.min(...xs)
  const x1 = Math.max(...xs)
  const z0 = Math.min(...zs)
  const z1 = Math.max(...zs)
  const pad = Math.max(x1 - x0, z1 - z0) * 0.06
  return `${x0 - pad} ${z0 - pad} ${x1 - x0 + 2 * pad} ${z1 - z0 + 2 * pad}`
})
const section = computed(() => pts([...props.drawing.upper, ...[...props.drawing.lower].reverse()]))
const spare = computed(() => format(Math.max(0, -props.drawing.shortfall), 'thin', defaultUnit(props.system, 'thin')))
const short = computed(() => format(Math.max(0, props.drawing.shortfall), 'thin', defaultUnit(props.system, 'thin')))
const forward = computed(() => (props.drawing.offset > 0 ? format(props.drawing.offset, 'thin', defaultUnit(props.system, 'thin')) : null))
</script>

<template>
  <figure class="wc-figure wc-edgefit">
    <svg :viewBox="view" preserveAspectRatio="xMidYMid meet" role="img" :aria-label="`${name}: how the stock fits the section ${drawing.where}`">
      <polygon :points="pts(drawing.stock)" class="wc-edgefit__stock" />
      <polyline :points="section" class="wc-edgefit__section" />
      <polygon v-for="(p, i) in drawing.short" :key="i" :points="pts(p)" class="wc-edgefit__short" />
    </svg>
    <figcaption class="wc-figure__caption">
      <span>
        <strong>{{ name }} {{ drawing.where }}</strong>, true to scale: the {{ round ? 'rod' : 'stock as sold' }} shaded, the
        section as a line.
      </span>
      <span v-if="drawing.fits">
        {{ round ? 'It sits within the section everywhere.' : `It carves to the section, with about ${spare} to spare at the tightest point.` }}
      </span>
      <span v-if="forward">It sits {{ forward }} forward of the nose, so it fits: the part ahead of the nose is carved away, and the ribs are cut back that much less.</span>
      <span v-else class="wc-text-bad">
        {{ round ? `Red is where it stands proud of the section, by up to ${short}.` : `Red is the section the stock can't reach: about ${short} short.` }}
      </span>
    </figcaption>
  </figure>
</template>
