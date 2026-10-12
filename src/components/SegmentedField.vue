<script setup>
// Labelled segmented control: one choice from a few, all visible.
defineProps({
  modelValue: { type: [String, Number, Boolean], default: null },
  label: { type: String, required: true },
  options: { type: Array, required: true }, // [{ value, label, title?, disabled? }]
  hint: { type: String, default: '' },
  small: { type: Boolean, default: true },
})
const emit = defineEmits(['update:modelValue'])
</script>

<template>
  <div class="wc-field">
    <span class="wc-field__label">{{ label }}</span>
    <div class="wc-segmented" :class="{ 'wc-segmented--small': small }" role="radiogroup" :aria-label="label">
      <button
        v-for="o in options"
        :key="String(o.value)"
        type="button"
        role="radio"
        :aria-checked="modelValue === o.value"
        class="wc-segmented__btn"
        :class="{ 'wc-segmented__btn--active': modelValue === o.value }"
        :title="o.title"
        :disabled="o.disabled"
        @click="emit('update:modelValue', o.value)"
      >
        {{ o.label }}
      </button>
    </div>
    <p v-if="hint" class="wc-field__hint">{{ hint }}</p>
  </div>
</template>
