<script setup>
// Labelled drop-down for a choice from a list, e.g. a material. Options with a group are
// gathered under that heading, in the order the groups first appear.
import { computed } from 'vue'

const props = defineProps({
  modelValue: { type: [String, Number], default: null },
  label: { type: String, required: true },
  id: { type: String, required: true },
  options: { type: Array, required: true }, // [{ value, label, title?, group? }]
  hint: { type: String, default: '' },
})
const emit = defineEmits(['update:modelValue'])

// Runs of options: ungrouped ones stand alone, grouped ones go under their heading
const runs = computed(() => {
  const out = []
  for (const o of props.options) {
    const last = out.at(-1)
    if (o.group && last?.group === o.group) last.options.push(o)
    else if (o.group) out.push({ group: o.group, options: [o] })
    else out.push({ group: null, options: [o] })
  }
  return out
})
</script>

<template>
  <div class="wc-field">
    <label :for="id" class="wc-field__label">{{ label }}</label>
    <div class="wc-field__control">
      <select :id="id" class="wc-input wc-select" :value="modelValue" @change="emit('update:modelValue', $event.target.value)">
        <template v-for="(r, i) in runs" :key="i">
          <optgroup v-if="r.group" :label="r.group">
            <option v-for="o in r.options" :key="o.value" :value="o.value" :title="o.title">{{ o.label }}</option>
          </optgroup>
          <option v-else :value="r.options[0].value" :title="r.options[0].title">{{ r.options[0].label }}</option>
        </template>
      </select>
    </div>
    <p v-if="hint" class="wc-field__hint">{{ hint }}</p>
  </div>
</template>
