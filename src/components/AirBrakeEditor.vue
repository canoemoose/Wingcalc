<script setup>
// Numeric entry for the wing's air brakes: lattice blade brakes and pop-up spoilers. Each brake
// is a foldable section, sharing the selection with the wing plan editor: opening one selects
// it, and selecting one in the plan opens it. Every change replaces the whole controls object,
// so undo/redo and autosave see it. Each brake also carries its servo bay's settings
// (servos.js, under the brake's key): on or off, the class, and where along the span.
import { TRASH } from '../lib/icons.js'
import { computed } from 'vue'
import UnitInput from './UnitInput.vue'
import ParamInput from './ParamInput.vue'
import SelectField from './SelectField.vue'
import SegmentedField from './SegmentedField.vue'
import InspectorSection from './InspectorSection.vue'
import { wingSampler } from '../lib/wing.js'
import { BRAKE_TYPES, MAX_BLADES, resolveBrakes, addBrake, brakeKey } from '../lib/airBrakes.js'
import { SERVOS, SERVO_CLASSES, bayOf, setBay, dropBay, defaultServoClass } from '../lib/servos.js'
import { format, defaultUnit } from '../lib/units.js'

const props = defineProps({
  system: { type: [String, Object], required: true }, // a units setting (units.js normaliseUnits) or system name
  // The wing the brakes sit on: { fuselageWidth, rootChord, panels, tip }
  wing: { type: Object, required: true },
  // The panel selected in the plan, where Add puts a new brake
  selectedPanel: { type: Number, default: null },
  // The all-up mass, kg: which servo class a bay takes unless one is chosen
  mass: { type: Number, default: 0 },
  idPrefix: { type: String, default: 'wc' },
})
const controls = defineModel('controls', { type: Object, required: true })
const selected = defineModel('selected', { type: Number, default: null })

const sampler = computed(() => wingSampler(props.wing))
const brakes = computed(() => controls.value.brakes ?? [])
const resolved = computed(() => (sampler.value ? resolveBrakes(sampler.value, brakes.value) : []))
// In order along the span, as named (AB1, AB2 …)
const shown = computed(() => resolved.value.map((r) => ({ r, b: brakes.value.find((x) => x.id === r.id) })).filter((x) => x.b))

const id = (k) => `${props.idPrefix}-ab-${k}`
const len = (v) => (Number.isFinite(v) ? format(v, 'length', defaultUnit(props.system, 'length')) : '–')

const TYPE_OPTIONS = Object.entries(BRAKE_TYPES).map(([value, t]) => ({ value, label: t.label }))
const SURFACE_OPTIONS = [
  { value: 'top', label: 'Top only' },
  { value: 'both', label: 'Top and bottom' },
]
const panelOptions = computed(() => props.wing.panels.map((p, i) => ({ value: String(p.id), label: `Panel ${i + 1}` })))
const panelIndex = (pid) => props.wing.panels.findIndex((p) => p.id === pid)
const panelLength = (pid) => props.wing.panels[panelIndex(pid)]?.length ?? null

function update(bid, patch) {
  controls.value = { ...controls.value, brakes: brakes.value.map((x) => (x.id === bid ? { ...x, ...patch } : x)) }
}
// Moving to another panel keeps the centre where it fits on the new one
function setPanel(b, value) {
  const pid = Number(value)
  const L = panelLength(pid)
  if (!(L > 0)) return
  update(b.id, { panel: pid, at: Math.min(Math.max(b.at, 0), L) })
}
function remove(bid) {
  controls.value = dropBay({ ...controls.value, brakes: brakes.value.filter((x) => x.id !== bid) }, brakeKey(bid))
  if (selected.value === bid) selected.value = null
}

// Servo bays
const bayFor = (b) => bayOf(controls.value, brakeKey(b.id))
const classOf = (b) => bayFor(b).class ?? defaultServoClass(props.mass)
const setBayFor = (b, patch) => (controls.value = setBay(controls.value, brakeKey(b.id), patch))
const servoOptions = computed(() => [
  { value: '', label: `Automatic (${SERVOS[defaultServoClass(props.mass)].label.toLowerCase()}, for this weight)` },
  ...SERVO_CLASSES.map((k) => ({ value: k, label: `${SERVOS[k].label} (${SERVOS[k].size})` })),
])

// On the panel selected in the plan, or the last one
const addTo = computed(() => (Number.isInteger(props.selectedPanel) && props.selectedPanel < props.wing.panels.length ? props.selectedPanel : props.wing.panels.length - 1))
const nextType = computed(() => (brakes.value.length ? brakes.value.at(-1).type : 'blade'))
const canAdd = computed(() => !!(sampler.value && addBrake(sampler.value, brakes.value, addTo.value, nextType.value)))
function add(type = nextType.value) {
  const res = sampler.value && addBrake(sampler.value, brakes.value, addTo.value, type)
  if (!res) return
  controls.value = { ...controls.value, brakes: res.brakes }
  selected.value = res.id
}

const PROBLEMS = {
  panel: 'Its panel is gone: choose another.',
  size: 'A size or position is missing or out of range, so it’s left out.',
  span: 'Its ribs would run off its panel, or too near the root or tip rib of it, so it’s left out. Move it along the span or make it shorter.',
  overlap: 'Its ribs would be on top of another air brake, so it’s left out.',
  outside: 'It lies outside the ribs, so it’s left out.',
}

function summary(r, b) {
  const i = panelIndex(b.panel)
  const where = i >= 0 ? `panel ${i + 1}, ${len(b.at)} out` : 'no panel'
  const what =
    b.type === 'blade'
      ? `${b.blades === 1 ? 'a blade' : `${b.blades} blades`} ${len(b.height)} high${b.surface === 'both' ? ', top and bottom' : ''}`
      : `${len(b.chord)} chord plate, ${Math.round(b.angle)}° open`
  const bay = bayFor(b).enabled ? `${SERVOS[classOf(b)].label.toLowerCase()} servo` : 'no servo bay'
  return `${where}, ${what}, ${bay}${r.ok ? '' : ', not used'}`
}
const sectionSummary = computed(() => {
  if (!brakes.value.length) return 'None'
  return resolved.value.map((r) => r.name).join(', ')
})
</script>

<template>
  <InspectorSection title="Air brakes" :fold-key="`${idPrefix}:brakes`" :summary="sectionSummary" :open="selected !== null">
    <div class="wc-surfaces">
      <InspectorSection
        v-for="{ r, b } in shown"
        :key="b.id"
        :title="r.label"
        :fold-key="`${idPrefix}:brake-${b.id}`"
        :summary="summary(r, b)"
        :open-when="selected === b.id"
        :class="{ 'wc-fold--selected': selected === b.id }"
        @focusin="(e) => !e.target.closest('summary') && (selected = b.id)"
        @toggle="(o) => o && (selected = b.id)"
      >
        <div class="wc-panelset__actions">
          <button type="button" class="wc-iconbtn wc-iconbtn--danger" :aria-label="`Delete ${r.label}`" title="Delete this air brake" @click="remove(b.id)"><svg viewBox="0 0 24 24" aria-hidden="true"><path v-for="(d, k) in TRASH" :key="k" :d="d" /></svg></button>
        </div>
        <p v-if="!r.ok && PROBLEMS[r.problem]" class="wc-field__hint wc-text-warn">{{ PROBLEMS[r.problem] }}</p>
        <SegmentedField :model-value="b.type" label="Type" :options="TYPE_OPTIONS" @update:model-value="update(b.id, { type: $event })" />
        <SelectField :id="id(`${b.id}-panel`)" :model-value="String(b.panel)" label="On" :options="panelOptions" @update:model-value="setPanel(b, $event)" />
        <div class="wc-structure-editor__pair">
          <UnitInput :id="id(`${b.id}-at`)" :model-value="b.at" quantity="length" :system="system" label="Centre, along the span" @update:model-value="update(b.id, { at: $event })" />
          <UnitInput :id="id(`${b.id}-len`)" :model-value="b.length" quantity="length" :system="system" label="Length" @update:model-value="update(b.id, { length: $event })" />
        </div>
        <p class="wc-field__hint">
          Centre from the panel's inner end, flat along it. A rib goes at each end, a little further apart than the length{{ b.type === 'spoiler' ? ', with room for the frame' : '' }}.
        </p>
        <div class="wc-structure-editor__pair">
          <UnitInput :id="id(`${b.id}-x`)" :model-value="b.x" quantity="percent" :system="system" label="Position on the chord" @update:model-value="update(b.id, { x: $event })" />
          <UnitInput :id="id(`${b.id}-chord`)" :model-value="b.chord" quantity="length" :system="system" :label="b.type === 'blade' ? 'Box width' : 'Plate chord'" @update:model-value="update(b.id, { chord: $event })" />
        </div>
        <p class="wc-field__hint">
          Percent of the chord back from the leading edge, to the middle of the {{ b.type === 'blade' ? 'box' : 'plate' }}. Keep it clear of the main spar and of any hinge line beside it.
        </p>
        <template v-if="b.type === 'blade'">
          <UnitInput :id="id(`${b.id}-h`)" :model-value="b.height" quantity="length" :system="system" label="Blade height" @update:model-value="update(b.id, { height: $event })" />
          <ParamInput
            :id="id(`${b.id}-n`)"
            :model-value="b.blades"
            label="Blades"
            :min="1"
            :max="MAX_BLADES"
            :step="1"
            hint="One is a single blade; more stand side by side across the box as a lattice."
            @update:model-value="update(b.id, { blades: Math.round($event) })"
          />
          <SegmentedField :model-value="b.surface" label="Through" :options="SURFACE_OPTIONS" @update:model-value="update(b.id, { surface: $event })" />
          <p class="wc-field__hint">
            How far each blade rises above the skin: it needs that much depth inside the wing when retracted, and twice that when blades go through both skins.
          </p>
        </template>
        <template v-else>
          <ParamInput
            :id="id(`${b.id}-angle`)"
            :model-value="b.angle"
            label="Opens to"
            suffix="°"
            :min="10"
            :max="90"
            :step="1"
            hint="The plate is hinged along its front edge and lifts at the back."
            @update:model-value="update(b.id, { angle: $event })"
          />
        </template>
        <div class="wc-structure-editor__sub">
          <span class="wc-field__label">Servo bay</span>
          <label class="wc-check wc-structure-editor__check">
            <input type="checkbox" :checked="bayFor(b).enabled" @change="setBayFor(b, { enabled: $event.target.checked })" />
            A bay for this brake's servo
          </label>
          <template v-if="bayFor(b).enabled">
            <SelectField :id="id(`${b.id}-servo`)" :model-value="bayFor(b).class ?? ''" label="Servo" :options="servoOptions" @update:model-value="setBayFor(b, { class: $event || null })" />
            <UnitInput
              :id="id(`${b.id}-bay`)"
              :model-value="bayFor(b).at"
              quantity="length"
              :system="system"
              label="Bay centre"
              placeholder="Beside the brake"
              @update:model-value="setBayFor(b, { at: $event })"
            />
            <p class="wc-field__hint">
              Between two ribs behind the main spar. Leave it empty for the bay beside the brake, on its inboard side, sharing the brake's end rib. Its weight counts in the wing and relieves the spar in bending.
            </p>
          </template>
        </div>
      </InspectorSection>
      <p v-if="!shown.length" class="wc-field__hint">
        None. Add one to the selected panel here or from the plan's bar along the top: blades rise vertically out of a box in the wing, a spoiler is a plate hinged on the top surface.
      </p>
      <div class="wc-structure-editor__actions">
        <button type="button" class="wc-button wc-button--small wc-structure-editor__add" :disabled="!canAdd" :title="canAdd ? '' : 'No room left on that panel'" @click="add('blade')">
          Add blade brake to panel {{ addTo + 1 }}
        </button>
        <button type="button" class="wc-button wc-button--small wc-structure-editor__add" :disabled="!canAdd" :title="canAdd ? '' : 'No room left on that panel'" @click="add('spoiler')">
          Add spoiler to panel {{ addTo + 1 }}
        </button>
      </div>
    </div>
  </InspectorSection>
</template>
