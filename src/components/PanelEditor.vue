<script setup>
// Numeric entry for the panel wing: fuselage width, root chord, then each panel outward
// from the fuselage side. The same values can be dragged in the wing plan editor; the two
// share the selected panel.
import { computed } from 'vue'
import UnitInput from './UnitInput.vue'
import ParamInput from './ParamInput.vue'
import { panelAngle, appendPanel, removePanel } from '../lib/wing.js'
import { format, defaultUnit } from '../lib/units.js'

const props = defineProps({
  system: { type: String, required: true },
  warnFields: { type: Array, default: () => [] },
})
const rootChord = defineModel('rootChord', { type: Number, default: null })
const fuselageWidth = defineModel('fuselageWidth', { type: Number, default: 0 })
const panels = defineModel('panels', { type: Array, required: true })
const selected = defineModel('selected', { type: Number, default: null })

// Dihedral is entered either as an angle or as the rise of each panel's outer end. A panel
// carries a `rise` key (m, null while the box is empty) in rise mode and `dihedral`
// (degrees) otherwise. The mode follows the key, not its value, so clearing a box to
// retype it doesn't flip the mode.
const dihedralBy = computed(() => (panels.value.some((p) => 'rise' in p) ? 'rise' : 'angle'))

function setDihedralBy(mode) {
  if (mode === dihedralBy.value) return
  panels.value = panels.value.map(({ rise, dihedral, ...p }) => {
    const rad = panelAngle({ ...p, rise, dihedral }) ?? 0
    if (mode === 'rise') return { ...p, rise: (p.length ?? 0) * Math.sin(rad) }
    return { ...p, dihedral: Math.round(((rad * 180) / Math.PI) * 10) / 10 }
  })
}

function angleHint(p) {
  const rad = panelAngle(p)
  return rad === null ? '' : `${((rad * 180) / Math.PI).toFixed(1)}° to the horizontal`
}

function riseHint(p) {
  const rad = panelAngle(p)
  if (rad === null || !(p.length > 0)) return ''
  return `Outer end ${format(p.length * Math.sin(rad), 'length', defaultUnit(props.system, 'length'))} above the inner end`
}

function update(i, key, value) {
  panels.value = panels.value.map((p, j) => (j === i ? { ...p, [key]: value } : p))
}

// Straight edge, or a gentle curve to start from (refined by dragging in the plan editor).
function setEdge(i, edge, curved) {
  const p = panels.value[i]
  const bulge = edge === 'le' ? -0.15 : 0.15
  update(i, edge, curved ? { u: 0.5, d: bulge * Math.max(p.tipChord || 0, 0.05) } : null)
}

function add() {
  panels.value = appendPanel(panels.value, rootChord.value)
  selected.value = panels.value.length - 1
}

function remove(i) {
  panels.value = removePanel(panels.value, i)
  if (selected.value === i) selected.value = null
  else if (selected.value > i) selected.value -= 1
}

function title(i) {
  const n = panels.value.length
  if (n === 1) return 'Each wing panel'
  if (i === 0) return 'Panel 1 (inner)'
  if (i === n - 1) return `Panel ${i + 1} (tip)`
  return `Panel ${i + 1}`
}
</script>

<template>
  <div class="wc-panels">
    <UnitInput
      id="wc-fuselage"
      v-model="fuselageWidth"
      quantity="length"
      :system="system"
      label="Fuselage width"
      hint="Where the wing meets the fuselage. Panels start at its sides; use 0 for a one-piece wing measured from the centreline."
    />
    <UnitInput id="wc-root" v-model="rootChord" quantity="length" :system="system" label="Root chord" />
    <div class="wc-field">
      <span class="wc-field__label">Enter dihedral as</span>
      <div class="wc-segmented" role="radiogroup" aria-label="Enter dihedral as">
        <button
          v-for="m in [
            { id: 'angle', label: 'Angle' },
            { id: 'rise', label: 'Rise at outer end' },
          ]"
          :key="m.id"
          type="button"
          role="radio"
          :aria-checked="dihedralBy === m.id"
          class="wc-segmented__btn"
          :class="{ 'wc-segmented__btn--active': dihedralBy === m.id }"
          @click="setDihedralBy(m.id)"
        >
          {{ m.label }}
        </button>
      </div>
    </div>
    <fieldset
      v-for="(p, i) in panels"
      :key="p.id ?? i"
      class="wc-panelset"
      :class="{ 'wc-panelset--selected': selected === i }"
      @focusin="selected = i"
    >
      <legend class="wc-panelset__legend">
        <button type="button" class="wc-linkish" @click="selected = selected === i ? null : i">{{ title(i) }}</button>
      </legend>
      <button
        v-if="panels.length > 1"
        type="button"
        class="wc-panelset__remove"
        :aria-label="`Delete panel ${i + 1}`"
        title="Delete this panel"
        @click="remove(i)"
      >
        ×
      </button>
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
      <UnitInput
        :id="`wc-panel-${i}-sweep`"
        :model-value="p.sweep ?? 0"
        quantity="length"
        :system="system"
        label="Sweep (leading-edge offset)"
        :hint="i === 0 ? 'How far back the outer end of the leading edge sits from the inner end. Negative sweeps forward.' : ''"
        @update:model-value="update(i, 'sweep', $event ?? 0)"
      />
      <UnitInput
        v-if="dihedralBy === 'rise'"
        :id="`wc-panel-${i}-rise`"
        :model-value="p.rise"
        quantity="length"
        :system="system"
        label="Rise at outer end"
        :warn="warnFields.includes(`panel-${i}-rise`)"
        :hint="
          (i === 0 ? 'Height of the outer end above the inner end, with the wing level. Negative for anhedral. ' : '') +
          angleHint(p)
        "
        @update:model-value="update(i, 'rise', $event)"
      />
      <ParamInput
        v-else
        :id="`wc-panel-${i}-dihedral`"
        :model-value="p.dihedral ?? 0"
        label="Dihedral"
        suffix="°"
        :min="-10"
        :max="45"
        :step="0.5"
        :hint="
          (i === 0 ? 'Angle of the panel to the horizontal, seen from the front. Negative for anhedral. ' : '') +
          riseHint(p)
        "
        @update:model-value="update(i, 'dihedral', $event)"
      />
      <div class="wc-edges">
        <span class="wc-field__label">Edges</span>
        <label class="wc-check">
          <input type="checkbox" :checked="!!p.le" @change="setEdge(i, 'le', $event.target.checked)" /> Curved leading
          edge
        </label>
        <label class="wc-check">
          <input type="checkbox" :checked="!!p.te" @change="setEdge(i, 'te', $event.target.checked)" /> Curved trailing
          edge
        </label>
      </div>
    </fieldset>
    <div class="wc-panels__actions">
      <button type="button" class="wc-button" @click="add">Add panel</button>
    </div>
    <p class="wc-field__hint">
      A new panel is added at the tip, continuing the wing outward. Shape curves by dragging their handles in the wing
      plan.
    </p>
  </div>
</template>
