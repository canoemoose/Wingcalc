<script setup>
// Numeric entry for the wing's control surfaces (ailerons, flaps, flaperons) and crow. Each
// surface is a foldable section, sharing the selection with the wing plan editor: opening one
// selects it, and selecting one in the plan opens it. Every change replaces the whole controls
// object, so undo/redo and autosave see it. This is where a surface is (its extent, depth and
// throws) and what it does (crow, landing flap); its hinge gap and servo bay are structure, set
// in the structure editor (SurfaceStructure.vue).
import { TRASH } from '../lib/icons.js'
import { computed } from 'vue'
import UnitInput from './UnitInput.vue'
import ParamInput from './ParamInput.vue'
import SelectField from './SelectField.vue'
import SegmentedField from './SegmentedField.vue'
import InspectorSection from './InspectorSection.vue'
import { wingSampler } from '../lib/wing.js'
import { ROLES, resolveSurfaces, addSurface, crowState, MIN_SURFACE } from '../lib/controlSurfaces.js'
import { dropBay } from '../lib/servos.js'
import { format, defaultUnit } from '../lib/units.js'

const props = defineProps({
  system: { type: [String, Object], required: true }, // a units setting (units.js normaliseUnits) or system name
  // The wing the surfaces sit on: { fuselageWidth, rootChord, panels, tip }
  wing: { type: Object, required: true },
  // The panel selected in the plan, where Add puts a new surface
  selectedPanel: { type: Number, default: null },
  // The all-up mass, kg: which servo class a bay takes unless one is chosen
  mass: { type: Number, default: 0 },
  idPrefix: { type: String, default: 'wc' },
  // A new surface's depth (m): the trailing edge stock's width; null for a quarter of the chord
  surfaceDepth: { type: Number, default: null },
})
const controls = defineModel('controls', { type: Object, required: true })
const selected = defineModel('selected', { type: Number, default: null })

const sampler = computed(() => wingSampler(props.wing))
const resolved = computed(() => (sampler.value ? resolveSurfaces(sampler.value, controls.value.surfaces) : []))
// In order along the span, as named (F1, A1 …)
// The local chord at flat span position s, so a hinge can be typed in millimetres
const chordAt = (s) => (Number.isFinite(s) ? sampler.value?.at(s)?.c ?? null : null)
const shown = computed(() => resolved.value.map((r) => ({ r, s: controls.value.surfaces.find((x) => x.id === r.id) })).filter((x) => x.s))
const crow = computed(() => crowState(controls.value))

const id = (k) => `${props.idPrefix}-cs-${k}`
const len = (v) => (Number.isFinite(v) ? format(v, 'length', defaultUnit(props.system, 'length')) : '–')

const ROLE_OPTIONS = Object.entries(ROLES).map(([value, r]) => ({ value, label: r.label }))
const panelOptions = computed(() => props.wing.panels.map((p, i) => ({ value: String(p.id), label: `Panel ${i + 1}` })))
const panelIndex = (pid) => props.wing.panels.findIndex((p) => p.id === pid)
const panelLength = (pid) => props.wing.panels[panelIndex(pid)]?.length ?? null

function update(sid, patch) {
  controls.value = { ...controls.value, surfaces: controls.value.surfaces.map((x) => (x.id === sid ? { ...x, ...patch } : x)) }
}
// A new role takes that role's usual throws
function setRole(s, role) {
  if (role === s.role) return
  update(s.id, { role, up: ROLES[role].up, down: ROLES[role].down })
}
// Moving to another panel keeps the surface's ends where they fit on the new one
function setPanel(s, value) {
  const pid = Number(value)
  const L = panelLength(pid)
  if (!(L > 0)) return
  const to = Math.min(L, s.to)
  update(s.id, { panel: pid, to, from: Math.min(s.from, Math.max(0, to - MIN_SURFACE)) })
}
function remove(sid) {
  controls.value = dropBay({ ...controls.value, surfaces: controls.value.surfaces.filter((x) => x.id !== sid) }, sid)
  if (selected.value === sid) selected.value = null
}

// On the panel selected in the plan, or the last one
const addTo = computed(() => (Number.isInteger(props.selectedPanel) && props.selectedPanel < props.wing.panels.length ? props.selectedPanel : props.wing.panels.length - 1))
const canAdd = computed(() => !!(sampler.value && addSurface(sampler.value, controls.value.surfaces, addTo.value, { depth: props.surfaceDepth })))
function add() {
  const res = sampler.value && addSurface(sampler.value, controls.value.surfaces, addTo.value, { depth: props.surfaceDepth })
  if (!res) return
  controls.value = { ...controls.value, surfaces: res.surfaces }
  selected.value = res.id
}
function setCrow(key, value) {
  controls.value = { ...controls.value, crow: { ...controls.value.crow, [key]: value } }
}

const PROBLEMS = {
  panel: 'Its panel is gone: choose another.',
  span: 'Its ends are back to front, less than 20 mm apart, or off the end of its panel.',
  hinge: 'Its hinge line is outside the chord.',
  overlap: 'It overlaps another surface on this panel, so it’s left out.',
}

function summary(r, s) {
  const i = panelIndex(s.panel)
  const where = i >= 0 ? `panel ${i + 1}, ${len(s.from)} to ${len(s.to)}` : 'no panel'
  const hinge = Math.round(s.hingeIn * 100) === Math.round(s.hingeOut * 100) ? `${Math.round(s.hingeIn * 100)}%` : `${Math.round(s.hingeIn * 100)} to ${Math.round(s.hingeOut * 100)}%`
  return `${where}, hinge at ${hinge}, ${s.up}° up, ${s.down}° down${r.ok ? '' : ', not used'}`
}
const sectionSummary = computed(() => {
  const n = controls.value.surfaces.length
  if (!n) return 'None'
  const names = resolved.value.map((r) => r.name).join(', ')
  return `${names}; crow ${crow.value.available ? (crow.value.enabled ? 'on' : 'available') : 'not available'}`
})
const crowText = computed(() => {
  const c = crow.value
  if (c.reason === 'flaperon') return 'Crow needs ailerons and flaps as separate surfaces. A flaperon is both at once, so it can’t go up as an aileron and down as a flap together.'
  if (c.reason === 'missing') return 'Crow needs separate ailerons and flaps: add both to use it.'
  return ''
})
const crowResult = computed(() => {
  const c = crow.value
  if (!c.available) return ''
  const byRole = (role) => c.deflections.filter((d) => d.role === role).map((d) => Math.abs(d.deflection))
  const range = (v) => (Math.min(...v) === Math.max(...v) ? `${Math.min(...v)}°` : `${Math.min(...v)}° to ${Math.max(...v)}°`)
  return `Ailerons go ${range(byRole('aileron'))} up and flaps ${range(byRole('flap'))} down, each no further than its own throw. Choose Crow under Stall speed for its stall speed and stall character.`
})

// Landing flap: how far flaps and flaperons go down for the stall speed with flaps
const flapSurfaces = computed(() => controls.value.surfaces.filter((s) => s.role === 'flap' || s.role === 'flaperon'))
const fullFlap = computed(() => Math.max(0, ...flapSurfaces.value.map((s) => s.down)))
const landingFlap = computed(() => controls.value.landing?.flapDown ?? fullFlap.value)
function setLanding(v) {
  controls.value = { ...controls.value, landing: { ...(controls.value.landing ?? {}), flapDown: v } }
}
</script>

<template>
  <InspectorSection title="Control surfaces" :fold-key="`${idPrefix}:controls`" :summary="sectionSummary" :open="selected !== null">
    <div class="wc-surfaces">
      <InspectorSection
        v-for="{ r, s } in shown"
        :key="s.id"
        :title="r.label"
        :fold-key="`${idPrefix}:surface-${s.id}`"
        :summary="summary(r, s)"
        :open-when="selected === s.id"
        :class="{ 'wc-fold--selected': selected === s.id }"
        @focusin="(e) => !e.target.closest('summary') && (selected = s.id)"
        @toggle="(o) => o && (selected = s.id)"
      >
        <div class="wc-panelset__actions">
          <button type="button" class="wc-iconbtn wc-iconbtn--danger" :aria-label="`Delete ${r.label}`" title="Delete this surface" @click="remove(s.id)"><svg viewBox="0 0 24 24" aria-hidden="true"><path v-for="(d, k) in TRASH" :key="k" :d="d" /></svg></button>
        </div>
        <p v-if="!r.ok && PROBLEMS[r.problem]" class="wc-field__hint wc-text-warn">{{ PROBLEMS[r.problem] }}</p>
        <SegmentedField :model-value="s.role" label="Role" :options="ROLE_OPTIONS" @update:model-value="setRole(s, $event)" />
        <SelectField :id="id(`${s.id}-panel`)" :model-value="String(s.panel)" label="On" :options="panelOptions" @update:model-value="setPanel(s, $event)" />
        <div class="wc-structure-editor__pair">
          <UnitInput :id="id(`${s.id}-from`)" :model-value="s.from" quantity="length" :system="system" label="From" @update:model-value="update(s.id, { from: $event })" />
          <UnitInput :id="id(`${s.id}-to`)" :model-value="s.to" quantity="length" :system="system" label="To" @update:model-value="update(s.id, { to: $event })" />
        </div>
        <p class="wc-field__hint">From the panel's inner end, flat along it. A rib goes at each end.</p>
        <div class="wc-structure-editor__pair">
          <UnitInput :id="id(`${s.id}-hin`)" :model-value="r.hingeIn ?? s.hingeIn" quantity="percent" :system="system" :chord="chordAt(r.s0)" chord-name="chord there" label="Hinge, inner end" @update:model-value="update(s.id, { hingeIn: $event, depth: null })" />
          <UnitInput :id="id(`${s.id}-hout`)" :model-value="r.hingeOut ?? s.hingeOut" quantity="percent" :system="system" :chord="chordAt(r.s1)" chord-name="chord there" label="Hinge, outer end" @update:model-value="update(s.id, { hingeOut: $event, depth: null })" />
        </div>
        <p class="wc-field__hint">Percent of the chord back from the leading edge; 75% makes a surface a quarter of the chord. The hinge runs straight between its ends.</p>
        <ParamInput :id="id(`${s.id}-up`)" :model-value="s.up" label="Most up" suffix="°" :min="0" :max="60" :step="1" @update:model-value="update(s.id, { up: $event })" />
        <ParamInput
          :id="id(`${s.id}-down`)"
          :model-value="s.down"
          label="Most down"
          suffix="°"
          :min="0"
          :max="70"
          :step="1"
          hint="Trailing edge up and down. The hinge spar on the surface is bevelled to clear both."
          @update:model-value="update(s.id, { down: $event })"
        />
        <p class="wc-field__hint">The hinge gap and the servo bay are set in the structure editor, under Control surfaces.</p>
      </InspectorSection>
      <p v-if="!shown.length" class="wc-field__hint">
        None. Add one to the selected panel here or from the plan's bar along the top: the first is an aileron, later ones flaps.
      </p>
      <button type="button" class="wc-button wc-button--small wc-structure-editor__add" :disabled="!canAdd" :title="canAdd ? '' : 'No room left on that panel'" @click="add">
        Add control surface to panel {{ addTo + 1 }}
      </button>

      <div v-if="flapSurfaces.length" class="wc-structure-editor__sub">
        <span class="wc-field__label">Landing flap</span>
        <ParamInput
          :id="id('landing-flap')"
          :model-value="landingFlap"
          label="Flaps down"
          suffix="°"
          :min="0"
          :max="70"
          :step="1"
          hint="For the stall speed with flaps (choose Flaps under Stall speed). Each flap and flaperon goes no further than its own most down."
          @update:model-value="setLanding"
        />
      </div>

      <div class="wc-structure-editor__sub">
        <span class="wc-field__label">Crow</span>
        <p v-if="crowText" class="wc-field__hint">{{ crowText }}</p>
        <template v-else>
          <label class="wc-check wc-structure-editor__check">
            <input type="checkbox" :checked="controls.crow.enabled" @change="setCrow('enabled', $event.target.checked)" />
            Crow braking: ailerons up, flaps down
          </label>
          <template v-if="controls.crow.enabled">
            <ParamInput :id="id('crow-up')" :model-value="controls.crow.aileronUp" label="Ailerons up" suffix="°" :min="0" :max="60" :step="1" @update:model-value="setCrow('aileronUp', $event)" />
            <ParamInput :id="id('crow-down')" :model-value="controls.crow.flapDown" label="Flaps down" suffix="°" :min="0" :max="80" :step="1" @update:model-value="setCrow('flapDown', $event)" />
            <p class="wc-field__hint">{{ crowResult }}</p>
          </template>
        </template>
      </div>
    </div>
  </InspectorSection>
</template>
