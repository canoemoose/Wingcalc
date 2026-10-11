<script setup>
// Half-wing panel editor: root chord, then each panel outward from the centreline with its
// length, outer chord and dihedral. One flat panel is a plain tapered wing; more panels
// give cranked planforms and dihedral or polyhedral breaks.
import { computed } from 'vue'
import UnitInput from './UnitInput.vue'
import ParamInput from './ParamInput.vue'
import { panelAngle } from '../lib/calc.js'
import { format, defaultUnit } from '../lib/units.js'

const MAX_PANELS = 5

const props = defineProps({
  system: { type: String, required: true },
  warnFields: { type: Array, default: () => [] },
})
const rootChord = defineModel('rootChord', { type: Number, default: null })
const panels = defineModel('panels', { type: Array, required: true })

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

// Split the outer panel in half, keeping span, area and dihedral unchanged, so the new
// break can then be adjusted.
function addBreak() {
  const list = panels.value
  const last = list.at(-1)
  const inner = list.length > 1 ? list.at(-2).tipChord : rootChord.value
  const mid = inner > 0 && last.tipChord >= 0 ? (inner + last.tipChord) / 2 : last.tipChord
  const half = last.length > 0 ? last.length / 2 : last.length
  // Halving the rise too keeps the angle unchanged.
  const halfRise = Number.isFinite(last.rise) ? { rise: last.rise / 2 } : {}
  panels.value = [
    ...list.slice(0, -1),
    { ...last, length: half, tipChord: mid, ...halfRise },
    { ...last, length: half, ...halfRise },
  ]
}

// Merge the outer panel into the one inside it, keeping the overall length and tip chord.
// In rise mode the rises add, so the merged panel runs straight to the old tip.
function removeBreak() {
  const list = panels.value
  if (list.length < 2) return
  const last = list.at(-1)
  const prev = list.at(-2)
  const merged = { ...prev, length: (prev.length ?? 0) + (last.length ?? 0), tipChord: last.tipChord }
  if (Number.isFinite(prev.rise)) merged.rise = prev.rise + (last.rise ?? 0)
  panels.value = [...list.slice(0, -2), merged]
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
        :model-value="p.dihedral"
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
