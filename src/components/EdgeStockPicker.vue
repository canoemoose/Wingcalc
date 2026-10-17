<script setup>
// A drop-down for leading or trailing edge stock that shows each size's cross-section. All the
// thumbnails are drawn at one scale, so the sizes compare at a glance. Takes the same options as
// SelectField ({ value, label, title?, group? }) plus items: value -> catalogue item (or null for
// one without a drawing, such as Custom).
import { ref, computed, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { profileOutline } from '../lib/edgeStock.js'

const props = defineProps({
  modelValue: { type: String, default: null },
  label: { type: String, required: true },
  id: { type: String, required: true },
  options: { type: Array, required: true },
  items: { type: Object, default: () => ({}) },
  hint: { type: String, default: '' },
})
const emit = defineEmits(['update:modelValue'])

const open = ref(false)
const active = ref(-1)
const root = ref(null)
const list = ref(null)
const button = ref(null)

// Thumbnail box in px, and one scale for every item: the largest fits the box
const BOX_W = 40, BOX_H = 26
const scale = computed(() => {
  const its = Object.values(props.items).filter(Boolean)
  const w = Math.max(...its.map((i) => i.width), 1e-3), h = Math.max(...its.map((i) => i.height), 1e-3)
  return Math.min((BOX_W - 2) / w, (BOX_H - 2) / h)
})
// The section with its edge to the left, sitting on the box's centre line
function thumb(value) {
  const it = props.items[value]
  if (!it) return null
  const k = scale.value, x0 = (BOX_W - it.width * k) / 2
  const out = profileOutline(it)
  const zs = out.map(([, z]) => z), zMid = (Math.min(...zs) + Math.max(...zs)) / 2
  return out.map(([u, z]) => `${(x0 + u * k).toFixed(2)},${(BOX_H / 2 - (z - zMid) * k).toFixed(2)}`).join(' ')
}

const current = computed(() => props.options.find((o) => o.value === props.modelValue) ?? props.options[0])

// Groups in the order they first appear; ungrouped options stand alone
const runs = computed(() => {
  const out = []
  props.options.forEach((o, i) => {
    const last = out.at(-1)
    if (o.group && last?.group === o.group) last.options.push({ ...o, i })
    else out.push({ group: o.group ?? null, options: [{ ...o, i }] })
  })
  return out
})

async function show() {
  open.value = true
  active.value = Math.max(0, props.options.findIndex((o) => o.value === props.modelValue))
  await nextTick()
  list.value?.focus()
  reveal()
}
function hide(focusButton = true) {
  open.value = false
  if (focusButton) button.value?.focus()
}
function choose(i) {
  const o = props.options[i]
  if (o) emit('update:modelValue', o.value)
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
  const n = props.options.length
  const step = { ArrowDown: 1, ArrowUp: -1 }[e.key]
  if (step) active.value = (active.value + step + n) % n
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
onMounted(() => document.addEventListener('pointerdown', onOutside))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onOutside))
</script>

<template>
  <div ref="root" class="wc-field wc-stockpick">
    <label :for="id" class="wc-field__label">{{ label }}</label>
    <div class="wc-field__control">
      <button
        :id="id"
        ref="button"
        type="button"
        class="wc-input wc-select wc-stockpick__btn"
        aria-haspopup="listbox"
        :aria-expanded="open"
        :aria-controls="`${id}-list`"
        @click="open ? hide() : show()"
        @keydown="onButtonKey"
      >
        <svg class="wc-stockpick__thumb" :viewBox="`0 0 ${BOX_W} ${BOX_H}`" aria-hidden="true">
          <polygon v-if="thumb(current?.value)" :points="thumb(current.value)" />
        </svg>
        <span class="wc-stockpick__label">{{ current?.label }}</span>
        <span class="wc-stockpick__caret" aria-hidden="true">▾</span>
      </button>
      <ul
        v-if="open"
        :id="`${id}-list`"
        ref="list"
        class="wc-stockpick__list"
        role="listbox"
        tabindex="-1"
        :aria-label="label"
        :aria-activedescendant="`${id}-opt-${active}`"
        @keydown="onListKey"
      >
        <template v-for="(r, k) in runs" :key="k">
          <li v-if="r.group" class="wc-stockpick__group" role="presentation">{{ r.group }}</li>
          <li
            v-for="o in r.options"
            :id="`${id}-opt-${o.i}`"
            :key="o.value"
            :data-i="o.i"
            class="wc-stockpick__opt"
            :class="{ 'wc-stockpick__opt--active': o.i === active, 'wc-stockpick__opt--grouped': r.group }"
            role="option"
            :aria-selected="o.value === modelValue"
            @pointerenter="active = o.i"
            @click="choose(o.i)"
          >
            <svg class="wc-stockpick__thumb" :viewBox="`0 0 ${BOX_W} ${BOX_H}`" aria-hidden="true">
              <polygon v-if="thumb(o.value)" :points="thumb(o.value)" />
            </svg>
            <span class="wc-stockpick__text">
              <span>{{ o.label }}</span>
              <span v-if="o.title" class="wc-stockpick__title">{{ o.title }}</span>
            </span>
          </li>
        </template>
      </ul>
    </div>
    <p v-if="hint" class="wc-field__hint">{{ hint }}</p>
  </div>
</template>
