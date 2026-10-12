<script setup>
// The vertical rail of editing tools on a drawing's left edge (after Screenvision's): an
// icon over a short caption per button. Tools are radio-style (one pressed); actions just
// fire. null in the list is a separator.
defineProps({
  // [{ id, caption, title, icon: [path data], kind: 'tool' | 'action', pressed?, disabled? } | null]
  items: { type: Array, required: true },
  label: { type: String, default: 'Tools' },
})
const emit = defineEmits(['pick'])
</script>

<template>
  <div class="wc-rail" role="toolbar" aria-orientation="vertical" :aria-label="label">
    <template v-for="(it, k) in items" :key="it ? it.id : 'sep' + k">
      <span v-if="!it" class="wc-rail__sep" role="separator" />
      <button
        v-else
        type="button"
        class="wc-rail__btn"
        :aria-pressed="it.kind === 'tool' ? String(!!it.pressed) : undefined"
        :disabled="it.disabled"
        :title="it.title"
        @click="emit('pick', it.id)"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path v-for="(d, j) in it.icon" :key="j" :d="d" /></svg>
        <span class="wc-rail__caption">{{ it.caption }}</span>
      </button>
    </template>
  </div>
</template>
