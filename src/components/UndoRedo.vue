<script setup>
// Undo and redo for the wing and structure history, at window level: in the page header and
// in each full-window editor's header. Ctrl+Z / Ctrl+Y (Ctrl+Shift+Z) are handled in WingCalc.
defineProps({
  canUndo: { type: Boolean, default: false },
  canRedo: { type: Boolean, default: false },
})
const emit = defineEmits(['undo', 'redo'])
</script>

<template>
  <div class="wc-undo" role="group" aria-label="History">
    <button type="button" class="wc-button" :disabled="!canUndo" title="Undo (Ctrl+Z)" @click="emit('undo')">Undo</button>
    <button type="button" class="wc-button" :disabled="!canRedo" title="Redo (Ctrl+Y)" @click="emit('redo')">Redo</button>
  </div>
</template>
