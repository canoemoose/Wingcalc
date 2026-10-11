<script setup>
// Slider plus number box for a dimensionless parameter (custom aerofoil inputs).
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
  const n = Number.parseFloat(v)
  if (!Number.isFinite(n)) return
  emit('update:modelValue', Math.min(props.max, Math.max(props.min, n)))
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
        @input="set($event.target.value)"
      />
      <input
        :id="id"
        class="wc-input wc-input--short"
        type="number"
        :min="min"
        :max="max"
        :step="step"
        :value="modelValue"
        @change="set($event.target.value)"
      />
      <span class="wc-param__suffix">{{ suffix }}</span>
    </div>
    <p v-if="hint" class="wc-field__hint">{{ hint }}</p>
  </div>
</template>
