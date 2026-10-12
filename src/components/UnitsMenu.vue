<script setup>
// The project's units: metric or imperial, then the unit for lengths, weights and speeds.
// Areas and wing loading follow (units.js defaultUnit). Kept with the project.
import { ref, computed } from 'vue'
import SegmentedField from './SegmentedField.vue'
import { useMenuDismiss } from '../composables/useMenuDismiss.js'
import { CHOICES, UNITS, SYSTEMS, normaliseUnits, defaultUnit } from '../lib/units.js'

const units = defineModel({ type: Object, required: true })
const menu = ref(null)
useMenuDismiss(menu)

const u = computed(() => normaliseUnits(units.value))
const label = (q, id) => UNITS[q][id].label
const summary = computed(() => ['length', 'mass', 'speed'].map((q) => label(q, u.value[q])).join(' · '))
const ROWS = [
  { q: 'length', label: 'Lengths' },
  { q: 'mass', label: 'Weights' },
  { q: 'speed', label: 'Speeds' },
]
const rows = computed(() => ROWS.filter((r) => CHOICES[u.value.system][r.q].length > 1))
const follows = computed(() => `Areas in ${label('area', defaultUnit(u.value, 'area'))}, wing loading in ${label('wingLoading', defaultUnit(u.value, 'wingLoading'))}.`)

// A new system starts from its own first units
function setSystem(system) {
  units.value = normaliseUnits(system)
}
function set(q, value) {
  units.value = { ...u.value, [q]: value }
}
</script>

<template>
  <details ref="menu" class="wc-project__menu wc-units">
    <summary class="wc-button" :title="`Units: ${SYSTEMS[u.system].label.toLowerCase()}, ${summary}`">
      {{ SYSTEMS[u.system].label }} <span class="wc-muted wc-units__summary">{{ summary }}</span>
      <span class="wc-project__caret" aria-hidden="true">▾</span>
    </summary>
    <div class="wc-project__popover wc-units__popover" role="group" aria-label="Units">
      <SegmentedField
        :model-value="u.system"
        label="System"
        :options="Object.entries(SYSTEMS).map(([value, s]) => ({ value, label: s.label }))"
        @update:model-value="setSystem"
      />
      <SegmentedField
        v-for="r in rows"
        :key="r.q"
        :model-value="u[r.q]"
        :label="r.label"
        :options="CHOICES[u.system][r.q].map((value) => ({ value, label: label(r.q, value) }))"
        @update:model-value="set(r.q, $event)"
      />
      <p class="wc-field__hint">
        {{ follows }} Any box takes other units typed after the number (12in, 1.2kg). Kept with the project.
      </p>
    </div>
  </details>
</template>
