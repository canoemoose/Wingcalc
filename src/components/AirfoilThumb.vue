<script setup>
// Small true-proportion outline of a section, for picker rows.
import { computed } from 'vue'

const props = defineProps({
  coords: { type: Array, required: true },
})

const points = computed(() => props.coords.map(([x, y]) => `${x.toFixed(4)},${(-y).toFixed(4)}`).join(' '))
</script>

<template>
  <svg class="wc-thumb" viewBox="-0.02 -0.14 1.04 0.24" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
    <polygon :points="points" />
  </svg>
</template>
