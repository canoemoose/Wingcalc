<script setup>
// How the leading or trailing edge stock fits the wing's section where the fit is tightest, at
// true proportions. Carved stock: the stock as sold (dashed) where it goes, square to the rib
// face or turned to the camber, what's left of it once carved to the section (shaded), the rib
// from its face back, the face itself (where the stock's flat back is glued) and the section as
// a line; in red, wood the stock hasn't got. A rod or dowel: the rod (shaded), the section, and
// in red where it stands proud.
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
const thin = (v) => format(v, 'thin', defaultUnit(props.system, 'thin'))
const spare = computed(() => thin(Math.max(0, -props.drawing.shortfall)))
const short = computed(() => thin(Math.max(0, props.drawing.shortfall)))
const carvedStock = computed(() => !props.round && !!props.drawing.carved)
const placed = computed(() => {
  const d = props.drawing
  if (!carvedStock.value) return null
  const edge = d.edge === 'le' ? 'nose' : 'trailing edge'
  if (d.inset) {
    const turn = Math.abs(d.angle) > 1e-4 ? `, turned ${Math.abs((d.angle * 180) / Math.PI).toFixed(1)}° so its bottom runs along the lower surface` : ', its bottom along the lower surface'
    const laid = d.laid === 'flat' ? ', laid flat' : d.laid === 'edge' ? ', on edge' : ''
    return `It's let into a notch in the ribs at the ${edge}${laid}${turn}, the rib over it and ${d.edge === 'le' ? 'behind' : 'ahead of'} it. It reaches ${thin(d.depth)} into the wing.`
  }
  const parts = []
  if (d.offset > 1e-5) parts.push(`set ${thin(d.offset)} ${d.edge === 'le' ? 'forward of' : 'aft of'} the ${edge}, the part past it carved away`)
  if (Math.abs(d.angle) > 1e-4) parts.push(`turned ${Math.abs((d.angle * 180) / Math.PI).toFixed(1)}° to follow the camber, the rib face cut to match`)
  else parts.push('square to the rib face')
  return `It sits ${parts.join(', ')}, and reaches ${thin(d.depth)} into the wing.`
})
</script>

<template>
  <figure class="wc-figure wc-edgefit">
    <svg :viewBox="view" preserveAspectRatio="xMidYMid meet" role="img" :aria-label="`${name}: how the stock fits the section ${drawing.where}`">
      <template v-if="carvedStock">
        <polygon v-if="drawing.rib.length > 2" :points="pts(drawing.rib)" class="wc-edgefit__rib" />
        <polygon :points="pts(drawing.stock)" class="wc-edgefit__sold" />
        <polygon v-if="drawing.carved.length > 2" :points="pts(drawing.carved)" class="wc-edgefit__stock" />
        <polyline :points="pts(drawing.upper)" class="wc-edgefit__section" />
        <polyline :points="pts(drawing.lower)" class="wc-edgefit__section" />
        <polyline :points="pts(drawing.face)" class="wc-edgefit__face" />
      </template>
      <template v-else>
        <polygon :points="pts(drawing.stock)" class="wc-edgefit__stock" />
        <polyline :points="pts([...drawing.upper].reverse().concat(drawing.lower))" class="wc-edgefit__section" />
      </template>
      <polygon v-for="(p, i) in drawing.short" :key="i" :points="pts(p)" class="wc-edgefit__short" />
    </svg>
    <figcaption class="wc-figure__caption">
      <span v-if="carvedStock">
        <strong>{{ name }} {{ drawing.where }}</strong>, true to scale: the stock as sold dashed, what's left once carved shaded,
        the rib behind its face, the section as a line.
      </span>
      <span v-else>
        <strong>{{ name }} {{ drawing.where }}</strong>, true to scale: the rod shaded, the section as a line.
      </span>
      <span v-if="placed">{{ placed }}</span>
      <template v-if="drawing.inset">
        <span v-if="drawing.fits">The rib keeps about {{ thin(drawing.over) }} over its back corner.</span>
        <span v-else class="wc-text-bad">
          The rib over its back corner would be {{ drawing.over > 0 ? `only ${thin(drawing.over)}` : 'nothing' }}: it needs at least 1.5 mm. Use a thinner strip.
        </span>
      </template>
      <template v-else>
        <span v-if="drawing.fits">
          {{ round ? 'It sits within the section everywhere.' : `It carves to the section, with about ${spare} to spare at the tightest point.` }}
        </span>
        <span v-else class="wc-text-bad">
          {{ round ? `Red is where it stands proud of the section, by up to ${short}.` : `Red is the section the stock can't reach: about ${short} short.` }}
        </span>
      </template>
    </figcaption>
  </figure>
</template>
