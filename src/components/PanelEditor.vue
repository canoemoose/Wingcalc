<script setup>
// Half-wing panel editor: root chord, then each panel outward from the centreline with its
// length, outer chord and dihedral. One flat panel is a plain tapered wing; more panels
// give cranked planforms and dihedral or polyhedral breaks.
import UnitInput from './UnitInput.vue'
import ParamInput from './ParamInput.vue'

const MAX_PANELS = 5

const props = defineProps({
  system: { type: String, required: true },
  warnFields: { type: Array, default: () => [] },
})
const rootChord = defineModel('rootChord', { type: Number, default: null })
const panels = defineModel('panels', { type: Array, required: true })

function update(i, key, value) {
  panels.value = panels.value.map((p, j) => (j === i ? { ...p, [key]: value } : p))
}

// Split the outer panel in half, keeping span, area and dihedral unchanged, so the new
// break can then be adjusted.
function addBreak() {
  const list = panels.value
  const last = list.at(-1)
  const inner = list.length > 1 ? list.at(-2).tipChord : rootChord.value
  const mid = inner > 0 && last.tipChord >= 0 ? (inner + last.tipChord) / 2 : last.tipChord
  const half = last.length > 0 ? last.length / 2 : last.length
  panels.value = [...list.slice(0, -1), { ...last, length: half, tipChord: mid }, { ...last, length: half }]
}

// Merge the outer panel into the one inside it, keeping the overall length and tip chord.
function removeBreak() {
  const list = panels.value
  if (list.length < 2) return
  const last = list.at(-1)
  const prev = list.at(-2)
  panels.value = [...list.slice(0, -2), { ...prev, length: (prev.length ?? 0) + (last.length ?? 0), tipChord: last.tipChord }]
}

function title(i) {
  const n = panels.value.length
  if (n === 1) return 'Each wing panel'
  if (i === 0) return `Panel 1 (centre)`
  if (i === n - 1) return `Panel ${i + 1} (tip)`
  return `Panel ${i + 1}`
}
</script>

<template>
  <div class="wc-panels">
    <UnitInput id="wc-root" v-model="rootChord" quantity="length" :system="system" label="Root chord" />
    <fieldset v-for="(p, i) in panels" :key="i" class="wc-panelset">
      <legend class="wc-panelset__legend">{{ title(i) }}</legend>
      <UnitInput
        :id="`wc-panel-${i}-length`"
        :model-value="p.length"
        quantity="length"
        :system="system"
        :label="panels.length === 1 ? 'Length, root to tip' : 'Length along the panel'"
        :hint="i === 0 ? 'One side only, measured flat along the panel.' : ''"
        @update:model-value="update(i, 'length', $event)"
      />
      <UnitInput
        :id="`wc-panel-${i}-chord`"
        :model-value="p.tipChord"
        quantity="length"
        :system="system"
        :label="i === panels.length - 1 ? 'Tip chord' : 'Chord at outer end'"
        :warn="warnFields.includes(`panel-${i}`)"
        @update:model-value="update(i, 'tipChord', $event)"
      />
      <ParamInput
        :id="`wc-panel-${i}-dihedral`"
        :model-value="p.dihedral"
        label="Dihedral"
        suffix="°"
        :min="-10"
        :max="45"
        :step="0.5"
        :hint="i === 0 ? 'Angle of the panel to the horizontal, seen from the front. Negative for anhedral.' : ''"
        @update:model-value="update(i, 'dihedral', $event)"
      />
    </fieldset>
    <div class="wc-panels__actions">
      <button v-if="panels.length < MAX_PANELS" type="button" class="wc-button" @click="addBreak">
        Add a break
      </button>
      <button v-if="panels.length > 1" type="button" class="wc-button" @click="removeBreak">
        Remove outer break
      </button>
    </div>
    <p class="wc-field__hint">
      A break splits the outer panel in half. Change its chords for a cranked planform, or its dihedral for
      polyhedral.
    </p>
  </div>
</template>
