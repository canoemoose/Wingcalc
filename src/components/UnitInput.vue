<script setup>
// Numeric input bound to a value in SI base units, displayed in a unit chosen from
// the current unit system. Accepts arithmetic and per-number units ("250-12", "12in");
// see src/lib/expr.js.
import { ref, watch, computed } from 'vue'
import { SYSTEMS, UNITS, defaultUnit, toBase, inputValue, format } from '../lib/units.js'
import { evaluate, isExpression } from '../lib/expr.js'

const props = defineProps({
  modelValue: { type: Number, default: null },
  quantity: { type: String, required: true },
  system: { type: String, required: true },
  label: { type: String, required: true },
  id: { type: String, required: true },
  warn: { type: Boolean, default: false },
  hint: { type: String, default: '' },
  // Compact: label kept for screen readers only and a fixed unit, for use in tables.
  compact: { type: Boolean, default: false },
  placeholder: { type: String, default: '' },
})
const emit = defineEmits(['update:modelValue'])

const unit = ref(defaultUnit(props.system, props.quantity))
const units = computed(() => SYSTEMS[props.system][props.quantity])
const text = ref(inputValue(props.modelValue, props.quantity, unit.value))
const focused = ref(false)

watch(
  () => props.system,
  (s) => {
    unit.value = defaultUnit(s, props.quantity)
  },
)

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

const parse = (t) => evaluate(t, { quantity: props.quantity, unit: unit.value })

// An empty box clears the value; an unfinished sum ("250 -") keeps the last good one.
function onInput(e) {
  text.value = e.target.value
  if (!text.value.trim()) {
    emit('update:modelValue', null)
    return
  }
  const n = parse(text.value)
  if (n !== null) emit('update:modelValue', toBase(n, props.quantity, unit.value))
}

// What a typed sum works out to, shown under the box while typing.
const preview = computed(() => {
  if (!focused.value || !isExpression(text.value)) return null
  const n = parse(text.value)
  if (n === null) return { ok: false, text: 'Not a complete sum yet' }
  return { ok: true, text: `= ${format(toBase(n, props.quantity, unit.value), props.quantity, unit.value)}` }
})

function tidy() {
  text.value = inputValue(props.modelValue, props.quantity, unit.value)
}

function onBlur() {
  focused.value = false
  tidy()
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
        @keydown.enter="tidy"
      />
      <select
        v-if="units.length > 1 && !compact"
        v-model="unit"
        class="wc-unit"
        :aria-label="`${label} unit`"
      >
        <option v-for="u in units" :key="u" :value="u">{{ UNITS[quantity][u].label }}</option>
      </select>
      <span v-else class="wc-unit wc-unit--fixed">{{ UNITS[quantity][compact ? unit : units[0]].label }}</span>
    </div>
    <p v-if="preview" class="wc-field__calc" :class="{ 'wc-field__calc--bad': !preview.ok }" aria-live="polite">
      {{ preview.text }}
    </p>
    <p v-if="hint" class="wc-field__hint">{{ hint }}</p>
  </div>
</template>
