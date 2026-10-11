<script setup>
// Numeric input bound to a value in SI base units, displayed in a unit chosen from
// the current unit system.
import { ref, watch, computed } from 'vue'
import { SYSTEMS, UNITS, defaultUnit, toBase, inputValue } from '../lib/units.js'

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

function onInput(e) {
  text.value = e.target.value
  const n = Number.parseFloat(text.value.replace(',', '.'))
  emit('update:modelValue', Number.isFinite(n) ? toBase(n, props.quantity, unit.value) : null)
}

function onBlur() {
  focused.value = false
  text.value = inputValue(props.modelValue, props.quantity, unit.value)
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
        :value="text"
        @input="onInput"
        @focus="focused = true"
        @blur="onBlur"
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
    <p v-if="hint" class="wc-field__hint">{{ hint }}</p>
  </div>
</template>
