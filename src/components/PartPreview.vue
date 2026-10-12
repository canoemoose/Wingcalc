<script setup>
// One part at true proportions: its cut outline, holes, engraved lines and label, with its size,
// quantity and notes. Steps through the parts in order.
import { computed } from 'vue'
import { bounds } from '../lib/ribs.js'
import { strokeText } from '../lib/strokeFont.js'
import { MATERIALS } from '../lib/structure.js'
import { format, defaultUnit } from '../lib/units.js'

const props = defineProps({
  parts: { type: Array, required: true },
  selected: { type: String, default: null },
  system: { type: [String, Object], required: true }, // a units setting (units.js normaliseUnits) or system name
})
const emit = defineEmits(['select'])

const index = computed(() => Math.max(0, props.parts.findIndex((p) => p.id === props.selected)))
const part = computed(() => props.parts[index.value] ?? null)

// SVG y runs down, so flip z.
const pts = (list) => list.map(([u, z]) => `${u.toFixed(5)},${(-z).toFixed(5)}`).join(' ')
const view = computed(() => {
  const b = bounds(part.value.outline)
  const pad = Math.max(b.w, b.h) * 0.04
  return { box: `${b.x0 - pad} ${-b.y1 - pad} ${b.w + 2 * pad} ${b.h + 2 * pad}`, b }
})
const label = computed(() => {
  const l = part.value.label
  if (!l?.text) return []
  return strokeText(l.text, l.u, l.z, l.h)
})
const len = (v) => format(v, 'thin', defaultUnit(props.system, 'thin'))
const step = (k) => {
  const n = props.parts.length
  emit('select', props.parts[(index.value + k + n) % n].id)
}
</script>

<template>
  <figure v-if="part" class="wc-figure wc-part">
    <div class="wc-part__head">
      <button type="button" class="wc-iconbtn" aria-label="Previous part" title="Previous part" @click="step(-1)">←</button>
      <select class="wc-input wc-select wc-select--small wc-part__pick" :value="part.id" aria-label="Part" @change="emit('select', $event.target.value)">
        <option v-for="p in parts" :key="p.id" :value="p.id">{{ p.name }}</option>
      </select>
      <button type="button" class="wc-iconbtn" aria-label="Next part" title="Next part" @click="step(1)">→</button>
      <span class="wc-part__size">
        {{ len(view.b.w) }} × {{ len(view.b.h) }}, {{ len(part.thickness) }} {{ MATERIALS[part.material]?.label.toLowerCase() }},
        {{ part.qty }} off
      </span>
    </div>
    <svg :viewBox="view.box" preserveAspectRatio="xMidYMid meet" role="img" :aria-label="`Part ${part.name}`">
      <polygon :points="pts(part.outline)" class="wc-part__cut" />
      <polygon v-for="(h, i) in part.holes" :key="'h' + i" :points="pts(h)" class="wc-part__hole" />
      <polyline v-for="(e, i) in part.etch" :key="'e' + i" :points="pts(e)" class="wc-part__etch" />
      <polyline v-for="(e, i) in label" :key="'l' + i" :points="pts(e)" class="wc-part__etch" />
    </svg>
    <figcaption v-if="part.notes.length" class="wc-figure__caption">
      <span v-for="(n, i) in part.notes" :key="i">{{ n }}.</span>
    </figcaption>
  </figure>
</template>
