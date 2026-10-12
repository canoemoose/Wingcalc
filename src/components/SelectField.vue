<script setup>
// Labelled drop-down for a choice from a list, e.g. a material.
defineProps({
  modelValue: { type: [String, Number], default: null },
  label: { type: String, required: true },
  id: { type: String, required: true },
  options: { type: Array, required: true }, // [{ value, label, title? }]
  hint: { type: String, default: '' },
})
const emit = defineEmits(['update:modelValue'])
</script>

<template>
  <div class="wc-field">
    <label :for="id" class="wc-field__label">{{ label }}</label>
    <div class="wc-field__control">
      <select :id="id" class="wc-input wc-select" :value="modelValue" @change="emit('update:modelValue', $event.target.value)">
        <option v-for="o in options" :key="o.value" :value="o.value" :title="o.title">{{ o.label }}</option>
      </select>
    </div>
    <p v-if="hint" class="wc-field__hint">{{ hint }}</p>
  </div>
</template>
