<script setup>
// A drawing's bottom-right corner: a snap toggle (in views that edit), then zoom out, zoom
// in and fit. The same in every view, with the same shortcuts (F, + and −), which each view
// handles itself while it has focus.
import { SNAP } from '../lib/icons.js'

defineProps({
  // The grid step, as text, for the snap toggle's tooltip; leave empty for no snap toggle
  snapStep: { type: String, default: '' },
  fitTitle: { type: String, default: 'Fit the drawing to the view (F)' },
})
const snap = defineModel('snap', { type: Boolean, default: true })
const emit = defineEmits(['zoom-in', 'zoom-out', 'fit'])
</script>

<template>
  <div class="wc-stage__corner wc-stage__corner--br" role="group" aria-label="View">
    <button
      v-if="snapStep"
      type="button"
      class="wc-button wc-stage__btn wc-stage__snap"
      :aria-pressed="String(snap)"
      :title="`Snap to the grid (${snapStep}). Hold Alt to place freely.`"
      @click="snap = !snap"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true"><path v-for="(d, k) in SNAP" :key="k" :d="d" /></svg>
      Snap
    </button>
    <button type="button" class="wc-button wc-stage__btn" aria-label="Zoom out" title="Zoom out (−)" @click="emit('zoom-out')">−</button>
    <button type="button" class="wc-button wc-stage__btn" aria-label="Zoom in" title="Zoom in (+)" @click="emit('zoom-in')">+</button>
    <button type="button" class="wc-button wc-stage__btn" :title="fitTitle" @click="emit('fit')">Fit</button>
  </div>
</template>
