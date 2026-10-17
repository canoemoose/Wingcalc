<script setup>
// Numeric input bound to a value in SI base units, displayed in the project's unit for its
// quantity (units.js defaultUnit). Accepts arithmetic and per-number units ("250-12", "12in",
// "1.2kg"); see src/lib/expr.js. A percent-of-chord box given its chord takes lengths too
// ("12mm"), converted to a percentage of that chord when committed.
import { ref, watch, computed } from 'vue'
import { UNITS, defaultUnit, toBase, inputValue, format } from '../lib/units.js'
import { evaluate, isExpression, hasLength } from '../lib/expr.js'

const props = defineProps({
  modelValue: { type: Number, default: null },
  quantity: { type: String, required: true },
  system: { type: [String, Object], required: true }, // a units setting (units.js normaliseUnits) or system name
  label: { type: String, required: true },
  id: { type: String, required: true },
  // True to mark the box, or the warning itself, shown under the box
  warn: { type: [Boolean, String], default: false },
  hint: { type: String, default: '' },
  // Compact: label kept for screen readers only, for use in tables.
  compact: { type: Boolean, default: false },
  placeholder: { type: String, default: '' },
  // Percent boxes: the chord (m) a typed length is a share of, and what to call it
  chord: { type: Number, default: null },
  chordName: { type: String, default: 'chord' },
})
const emit = defineEmits(['update:modelValue'])

const unit = computed(() => defaultUnit(props.system, props.quantity))
const text = ref(inputValue(props.modelValue, props.quantity, unit.value))
const focused = ref(false)

// Reformat when the unit changes, or when the value changes from outside while the
// user isn't typing in this box (so the caret never jumps mid-entry).
watch(unit, () => {
  text.value = inputValue(props.modelValue, props.quantity, unit.value)
})
watch(
  () => props.modelValue,
  (v) => {
    if (!focused.value) text.value = inputValue(v, props.quantity, unit.value)
  },
)

const parse = (t) => evaluate(t, { quantity: props.quantity, unit: unit.value, chord: props.chord })

// Typing only updates the text. The value is committed on Enter or when leaving the box,
// so the parent never reformats mid-entry.
function onInput(e) {
  text.value = e.target.value
}

// An empty box clears the value; an unfinished sum ("250 -") keeps the last good one.
function commit() {
  if (!text.value.trim()) {
    text.value = ''
    emit('update:modelValue', null)
    return
  }
  const n = parse(text.value)
  if (n === null) {
    tidy()
    return
  }
  const base = toBase(n, props.quantity, unit.value)
  // Format from the new value, not the prop: the prop only catches up on the next render.
  text.value = inputValue(base, props.quantity, unit.value)
  emit('update:modelValue', base)
}

// Escape drops the typed text and goes back to the last committed value without committing.
let reverting = false
function onEscape(e) {
  reverting = true
  tidy()
  e.target.blur()
}

// What a typed sum works out to, shown under the box while typing.
const preview = computed(() => {
  if (!focused.value || !isExpression(text.value)) return null
  const n = parse(text.value)
  if (n === null) return { ok: false, text: 'Not a complete sum yet' }
  const of = props.chord > 0 && hasLength(text.value) ? ` of the ${format(props.chord, 'length', defaultUnit(props.system, 'length'))} ${props.chordName}` : ''
  return { ok: true, text: `= ${format(toBase(n, props.quantity, unit.value), props.quantity, unit.value)}${of}` }
})

function tidy() {
  text.value = inputValue(props.modelValue, props.quantity, unit.value)
}

function onBlur() {
  focused.value = false
  if (reverting) {
    reverting = false
    tidy()
    return
  }
  commit()
}
</script>

<template>
  <div class="wc-field" :class="{ 'wc-field--warn': warn, 'wc-field--compact': compact }">
    <label :for="id" class="wc-field__label" :class="{ 'wc-sr-only': compact }">{{ label }}</label>
    <div class="wc-field__control">
      <input
        :id="id"
        class="wc-input"
        type="text"
        inputmode="decimal"
        autocomplete="off"
        :placeholder="placeholder"
        :value="text"
        @input="onInput"
        @focus="focused = true"
        @blur="onBlur"
        @keydown.enter="commit"
        @keydown.esc="onEscape"
      />
      <span class="wc-unit wc-unit--fixed">{{ UNITS[quantity][unit].label }}</span>
    </div>
    <p v-if="preview" class="wc-field__calc" :class="{ 'wc-field__calc--bad': !preview.ok }" aria-live="polite">
      {{ preview.text }}
    </p>
    <p v-if="typeof warn === 'string' && warn" class="wc-field__warn">{{ warn }}</p>
    <p v-if="hint" class="wc-field__hint">{{ hint }}</p>
  </div>
</template>
