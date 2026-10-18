<script setup>
// One part at true proportions: its cut outline, holes, engraved lines and label, with its size,
// quantity and notes, drawn flat or as a 3D solid of its thickness. Steps through the parts in
// order; the list opens with a thumbnail of each, grouped as in the export.
import { computed, ref, nextTick, onMounted, onBeforeUnmount, defineAsyncComponent } from 'vue'
import { bounds } from '../lib/ribs.js'
import { strokeText } from '../lib/strokeFont.js'
import { MATERIALS } from '../lib/structure.js'
import { format, defaultUnit } from '../lib/units.js'

// The 3D view loads (with three.js) only when it's first shown
const PartSolid = defineAsyncComponent(() => import('./PartSolid.vue'))

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
// The 3D view engraves the label with the other lines
const solidPart = computed(() => ({ ...part.value, etch: [...(part.value.etch ?? []), ...label.value] }))
const sizeText = (p) => {
  const b = bounds(p.outline)
  return `${len(b.w)} × ${len(b.h)}`
}
const step = (k) => {
  const n = props.parts.length
  emit('select', props.parts[(index.value + k + n) % n].id)
}

// Flat or 3D
const mode = ref('2d')

// --- The part list ------------------------------------------------------------------------------

const GROUPS = {
  ribs: 'Ribs',
  surfaces: 'Control surface ribs',
  hinges: 'Hinges',
  servos: 'Servo bays',
  brakes: 'Air brakes',
  gussets: 'Gussets',
  braces: 'Dihedral braces',
  webs: 'Shear webs',
  sheeting: 'Sheeting',
  tip: 'Tip',
  templates: 'Hot-wire templates',
  skins: 'Skins',
  pockets: 'Pocket templates',
}
// Groups in the order they first appear
const runs = computed(() => {
  const out = []
  props.parts.forEach((p, i) => {
    const last = out.at(-1)
    if (last?.group === p.group) last.items.push({ p, i })
    else out.push({ group: p.group, label: GROUPS[p.group] ?? p.group, items: [{ p, i }] })
  })
  return out
})

// Each thumbnail fitted to its own box, so a gusset reads as well as a rib: the outline and
// holes as one path, the holes cut out
const TW = 56
const TH = 30
function thumb(p) {
  const b = bounds(p.outline)
  const k = Math.min((TW - 4) / Math.max(b.w, 1e-6), (TH - 4) / Math.max(b.h, 1e-6))
  const x0 = (TW - b.w * k) / 2
  const y0 = (TH - b.h * k) / 2
  const ring = (list) => 'M' + list.map(([u, z]) => `${(x0 + (u - b.x0) * k).toFixed(1)},${(y0 + (b.y1 - z) * k).toFixed(1)}`).join('L') + 'Z'
  return [p.outline, ...(p.holes ?? [])].map(ring).join('')
}

const open = ref(false)
const active = ref(0)
const root = ref(null)
const list = ref(null)
const button = ref(null)
// The open list is fixed to the viewport, so it isn't clipped by the card
const place = ref({})
function position() {
  const r = button.value?.getBoundingClientRect()
  if (!r) return
  const vh = window.innerHeight
  const below = vh - r.bottom - 8
  const above = r.top - 8
  const up = below < 240 && above > below
  place.value = {
    left: `${Math.max(8, Math.min(r.left, window.innerWidth - 268))}px`,
    maxHeight: `${Math.min(420, up ? above : below)}px`,
    ...(up ? { bottom: `${vh - r.top + 2}px` } : { top: `${r.bottom + 2}px` }),
  }
}
async function show() {
  position()
  open.value = true
  active.value = index.value
  await nextTick()
  list.value?.focus()
  reveal()
}
function hide(focusButton = true) {
  open.value = false
  if (focusButton) button.value?.focus()
}
function choose(i) {
  const p = props.parts[i]
  if (p) emit('select', p.id)
  hide()
}
function reveal() {
  list.value?.querySelector(`[data-i="${active.value}"]`)?.scrollIntoView({ block: 'nearest' })
}
function onButtonKey(e) {
  if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
    e.preventDefault()
    show()
  }
}
function onListKey(e) {
  const n = props.parts.length
  const stepBy = { ArrowDown: 1, ArrowUp: -1 }[e.key]
  if (stepBy) active.value = (active.value + stepBy + n) % n
  else if (e.key === 'Home') active.value = 0
  else if (e.key === 'End') active.value = n - 1
  else if (e.key === 'Enter' || e.key === ' ') return e.preventDefault(), choose(active.value)
  else if (e.key === 'Escape') return e.preventDefault(), e.stopPropagation(), hide()
  else if (e.key === 'Tab') return hide(false)
  else return
  e.preventDefault()
  reveal()
}
function onOutside(e) {
  if (open.value && !root.value?.contains(e.target)) hide(false)
}
function onScroll(e) {
  if (open.value && e.target !== list.value) position()
}
onMounted(() => {
  document.addEventListener('pointerdown', onOutside)
  document.addEventListener('scroll', onScroll, true)
  window.addEventListener('resize', onScroll)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onOutside)
  document.removeEventListener('scroll', onScroll, true)
  window.removeEventListener('resize', onScroll)
})
const uid = `wc-part-${Math.random().toString(36).slice(2, 8)}`
</script>

<template>
  <figure v-if="part" class="wc-figure wc-part">
    <div class="wc-part__head">
      <button type="button" class="wc-iconbtn" aria-label="Previous part" title="Previous part" @click="step(-1)">←</button>
      <div ref="root" class="wc-part__picker">
        <button
          ref="button"
          type="button"
          class="wc-input wc-select wc-select--small wc-part__pick"
          aria-haspopup="listbox"
          :aria-expanded="open"
          :aria-controls="`${uid}-list`"
          aria-label="Part"
          @click="open ? hide() : show()"
          @keydown="onButtonKey"
        >
          <span>{{ part.name }}</span>
          <span class="wc-part__caret" aria-hidden="true">▾</span>
        </button>
        <ul
          v-if="open"
          :id="`${uid}-list`"
          ref="list"
          class="wc-part__list"
          :style="place"
          role="listbox"
          tabindex="-1"
          aria-label="Parts"
          :aria-activedescendant="`${uid}-opt-${active}`"
          @keydown="onListKey"
        >
          <template v-for="r in runs" :key="r.group + r.items[0].i">
            <li class="wc-part__group" role="presentation">{{ r.label }}</li>
            <li
              v-for="{ p, i } in r.items"
              :id="`${uid}-opt-${i}`"
              :key="p.id"
              :data-i="i"
              class="wc-part__opt"
              :class="{ 'wc-part__opt--active': i === active }"
              role="option"
              :aria-selected="p.id === part.id"
              @pointerenter="active = i"
              @click="choose(i)"
            >
              <svg class="wc-part__thumb" :viewBox="`0 0 ${TW} ${TH}`" aria-hidden="true"><path :d="thumb(p)" /></svg>
              <span class="wc-part__opt-text">
                <span>{{ p.name }}</span>
                <span class="wc-part__opt-size">{{ sizeText(p) }}, {{ p.qty }} off</span>
              </span>
            </li>
          </template>
        </ul>
      </div>
      <button type="button" class="wc-iconbtn" aria-label="Next part" title="Next part" @click="step(1)">→</button>
      <span class="wc-part__size">
        {{ len(view.b.w) }} × {{ len(view.b.h) }}, {{ len(part.thickness) }} {{ MATERIALS[part.material]?.label.toLowerCase() }},
        {{ part.qty }} off
      </span>
      <div class="wc-part__mode" role="group" aria-label="View">
        <button type="button" class="wc-button wc-part__modebtn" :aria-pressed="String(mode === '2d')" title="The part flat, as it's cut" @click="mode = '2d'">2D</button>
        <button type="button" class="wc-button wc-part__modebtn" :aria-pressed="String(mode === '3d')" title="The part in 3D, at its thickness" @click="mode = '3d'">3D</button>
      </div>
    </div>
    <svg v-if="mode === '2d'" :viewBox="view.box" preserveAspectRatio="xMidYMid meet" role="img" :aria-label="`Part ${part.name}`">
      <polygon :points="pts(part.outline)" class="wc-part__cut" />
      <polygon v-for="(h, i) in part.holes" :key="'h' + i" :points="pts(h)" class="wc-part__hole" />
      <polyline v-for="(e, i) in part.etch" :key="'e' + i" :points="pts(e)" class="wc-part__etch" />
      <polyline v-for="(e, i) in label" :key="'l' + i" :points="pts(e)" class="wc-part__etch" />
    </svg>
    <PartSolid v-else :part="solidPart" />
    <figcaption v-if="part.notes.length" class="wc-figure__caption">
      <span v-for="(n, i) in part.notes" :key="i">{{ n }}.</span>
    </figcaption>
  </figure>
</template>
