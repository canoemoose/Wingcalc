<script setup>
// Numeric entry for the panel wing: fuselage width, root chord, then each panel outward
// from the fuselage side. The same values can be dragged in the wing plan editor; the two
// share the selected panel.
import { computed } from 'vue'
import UnitInput from './UnitInput.vue'
import ParamInput from './ParamInput.vue'
import { panelAngle, appendPanel, removePanel, panelMode, setPanelMode, addStation } from '../lib/wing.js'
import { format, defaultUnit } from '../lib/units.js'

const props = defineProps({
  system: { type: String, required: true },
  warnFields: { type: Array, default: () => [] },
})
const rootChord = defineModel('rootChord', { type: Number, default: null })
const fuselageWidth = defineModel('fuselageWidth', { type: Number, default: 0 })
const panels = defineModel('panels', { type: Array, required: true })
const selected = defineModel('selected', { type: Number, default: null })
const tip = defineModel('tip', { type: Object, default: null })

const wing = () => ({ fuselageWidth: fuselageWidth.value, rootChord: rootChord.value, panels: panels.value })

const EDGE_MODES = [
  { id: 'straight', label: 'Straight' },
  { id: 'curves', label: 'Curves' },
  { id: 'stations', label: 'Chord stations' },
]

function setMode(i, mode) {
  if (panelMode(panels.value[i]) === mode) return
  panels.value = setPanelMode(wing(), i, mode)
}

function newStation(i) {
  panels.value = addStation(wing(), i)
}

function updateStation(i, id, key, value) {
  panels.value = panels.value.map((p, j) =>
    j === i ? { ...p, stations: p.stations.map((st) => (st.id === id ? { ...st, [key]: value } : st)) } : p,
  )
}

function removeStation(i, id) {
  panels.value = panels.value.map((p, j) => (j === i ? { ...p, stations: p.stations.filter((st) => st.id !== id) } : p))
}

const sortedStations = (p) => [...(p.stations ?? [])].sort((a, b) => a.d - b.d)

function setTip(on) {
  tip.value = on ? { extension: Math.max(0.02, (panels.value.at(-1)?.tipChord || 0.1) * 0.5), peak: 0.4 } : null
}

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
      <div class="wc-field">
        <span class="wc-field__label">Shape</span>
        <div class="wc-segmented wc-segmented--small" role="radiogroup" :aria-label="`Panel ${i + 1} shape`">
          <button
            v-for="m in EDGE_MODES"
            :key="m.id"
            type="button"
            role="radio"
            :aria-checked="panelMode(p) === m.id"
            class="wc-segmented__btn"
            :class="{ 'wc-segmented__btn--active': panelMode(p) === m.id }"
            @click="setMode(i, m.id)"
          >
            {{ m.label }}
          </button>
        </div>
      </div>
      <div v-if="panelMode(p) === 'curves'" class="wc-edges">
        <label class="wc-check">
          <input type="checkbox" :checked="!!p.le" @change="setEdge(i, 'le', $event.target.checked)" /> Curved leading
          edge
        </label>
        <label class="wc-check">
          <input type="checkbox" :checked="!!p.te" @change="setEdge(i, 'te', $event.target.checked)" /> Curved trailing
          edge
        </label>
      </div>
      <div v-else-if="panelMode(p) === 'stations'" class="wc-stations">
        <p class="wc-field__hint">
          Chords dimensioned along the panel. Both edges run smoothly through them. Distance is from the panel's inner
          end; set-back is how far the station's leading edge sits behind the panel's inner leading edge.
        </p>
        <div class="wc-stations__grid" role="table" :aria-label="`Panel ${i + 1} chord stations`">
          <span class="wc-stations__head" role="columnheader">Distance</span>
          <span class="wc-stations__head" role="columnheader">Chord</span>
          <span class="wc-stations__head" role="columnheader">LE set-back</span>
          <span />
          <template v-for="(st, k) in sortedStations(p)" :key="st.id">
            <UnitInput
              :id="`wc-p${i}-st${st.id}-d`"
              :model-value="st.d"
              quantity="length"
              :system="system"
              :label="`Station ${k + 1} distance`"
              compact
              :warn="!(st.d > 0 && st.d < p.length)"
              @update:model-value="updateStation(i, st.id, 'd', $event)"
            />
            <UnitInput
              :id="`wc-p${i}-st${st.id}-c`"
              :model-value="st.chord"
              quantity="length"
              :system="system"
              :label="`Station ${k + 1} chord`"
              compact
              @update:model-value="updateStation(i, st.id, 'chord', $event)"
            />
            <UnitInput
              :id="`wc-p${i}-st${st.id}-le`"
              :model-value="st.le"
              quantity="length"
              :system="system"
              :label="`Station ${k + 1} leading-edge set-back`"
              compact
              @update:model-value="updateStation(i, st.id, 'le', $event ?? 0)"
            />
            <button
              type="button"
              class="wc-stations__remove"
              :aria-label="`Remove station ${k + 1}`"
              title="Remove this station"
              @click="removeStation(i, st.id)"
            >
              ×
            </button>
          </template>
        </div>
        <button type="button" class="wc-button wc-button--small" @click="newStation(i)">Add station</button>
      </div>
    </fieldset>
    <div class="wc-panels__actions">
      <button type="button" class="wc-button" @click="add">Add panel</button>
    </div>
    <fieldset class="wc-panelset">
      <legend class="wc-panelset__legend">Wingtip</legend>
      <label class="wc-check wc-tipcheck">
        <input type="checkbox" :checked="!!tip" @change="setTip($event.target.checked)" /> Rounded tip beyond the last
        panel
      </label>
      <template v-if="tip">
        <UnitInput
          id="wc-tip-extension"
          :model-value="tip.extension"
          quantity="length"
          :system="system"
          label="Tip extension"
          hint="How far the rounded tip reaches beyond the end of the last panel."
          @update:model-value="tip = { ...tip, extension: $event }"
        />
        <ParamInput
          id="wc-tip-peak"
          :model-value="Math.round((tip.peak ?? 0.4) * 100)"
          label="Furthest point along the chord"
          suffix="% chord"
          :min="0"
          :max="100"
          :step="1"
          hint="0% rakes the tip back from the leading edge, 100% forward from the trailing edge; 40% looks like a classic rounded tip."
          @update:model-value="tip = { ...tip, peak: $event / 100 }"
        />
      </template>
    </fieldset>
    <p class="wc-field__hint">
      A new panel is added at the tip, continuing the wing outward. Shape curves by dragging their handles in the wing
      plan.
    </p>
  </div>
</template>
