<script setup>
// Slider plus number box for a dimensionless parameter. The box accepts arithmetic
// ("2.5 * 4"); see src/lib/expr.js.
import { ref, watch } from 'vue'
import { evaluate } from '../lib/expr.js'

const props = defineProps({
  modelValue: { type: Number, required: true },
  label: { type: String, required: true },
  id: { type: String, required: true },
  min: { type: Number, required: true },
  max: { type: Number, required: true },
  step: { type: Number, required: true },
  suffix: { type: String, default: '' },
  hint: { type: String, default: '' },
})
const emit = defineEmits(['update:modelValue'])

function set(v) {
  const n = typeof v === 'number' ? v : evaluate(String(v))
  if (n === null || !Number.isFinite(n)) return
  emit('update:modelValue', Math.min(props.max, Math.max(props.min, n)))
}

// The box keeps what's typed until Enter or leaving it, then shows the (clamped) value.
const text = ref(String(props.modelValue))
const focused = ref(false)
watch(
  () => props.modelValue,
  (v) => {
    if (!focused.value) text.value = String(v)
  },
)
function commit() {
  const n = evaluate(text.value)
  if (n === null) {
    text.value = String(props.modelValue)
    return
  }
  // Show the clamped value straight away; the prop only catches up on the next render.
  const v = Math.min(props.max, Math.max(props.min, n))
  emit('update:modelValue', v)
  text.value = String(v)
}
</script>

<template>
  <div class="wc-param">
    <label :for="id" class="wc-field__label">{{ label }}</label>
    <div class="wc-param__row">
      <input
        class="wc-range"
        type="range"
        :min="min"
        :max="max"
        :step="step"
        :value="modelValue"
        :aria-label="label"
        @input="set(Number($event.target.value))"
      />
      <input
        :id="id"
        v-model="text"
        class="wc-input wc-input--short"
        type="text"
        inputmode="decimal"
        autocomplete="off"
        @focus="focused = true"
        @blur="
          focused = false;
          commit()
        "
        @keydown.enter="commit"
      />
      <span class="wc-param__suffix">{{ suffix }}</span>
    </div>
    <p v-if="hint" class="wc-field__hint">{{ hint }}</p>
  </div>
</template>
