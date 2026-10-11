<script setup>
// Numeric entry for the wing's structure: design loads, spar, covering, edges, stringers,
// ribs, gussets and dihedral braces. Every change replaces the whole structure object, so
// undo/redo and autosave see it.
import { computed } from 'vue'
import UnitInput from './UnitInput.vue'
import ParamInput from './ParamInput.vue'
import SelectField from './SelectField.vue'
import SegmentedField from './SegmentedField.vue'
import { MATERIALS } from '../lib/structure.js'

const props = defineProps({
  system: { type: String, required: true },
  // The spar position the aerofoil suggests (its thickest point), shown as the placeholder
  autoSpar: { type: Number, default: null },
  // Brace thicknesses the loads call for, in metres, shown as placeholders
  braceNeeds: { type: Array, default: () => [] },
  idPrefix: { type: String, default: 'wcs' },
})
const structure = defineModel('structure', { type: Object, required: true })

// Replace the value at a dotted path, copying each object on the way down.
function set(path, value) {
  const keys = path.split('.')
  const copy = (obj, i) => {
    const out = Array.isArray(obj) ? [...obj] : { ...obj }
    out[keys[i]] = i === keys.length - 1 ? value : copy(obj[keys[i]], i + 1)
    return out
  }
  structure.value = copy(structure.value, 0)
}
const st = computed(() => structure.value)
const id = (k) => `${props.idPrefix}-${k}`

const materials = (ids) => ids.map((k) => ({ value: k, label: MATERIALS[k].label }))
const WOOD = materials(['balsa-light', 'balsa-medium', 'balsa-hard', 'spruce', 'basswood', 'ply-lite', 'ply-birch'])
const CAPS = materials(['spruce', 'basswood', 'balsa-hard', 'balsa-medium', 'carbon'])
const SHEET = materials(['balsa-light', 'balsa-medium', 'balsa-hard', 'ply-lite', 'ply-birch'])
const PLY = materials(['ply-birch', 'ply-lite', 'balsa-hard'])
const TUBE = materials(['carbon-tube'])

const SPAR_TYPES = [
  { value: 'caps', label: 'Caps and web' },
  { value: 'box', label: 'Box' },
  { value: 'tube', label: 'Tube' },
  { value: 'solid', label: 'Solid' },
]
const COVERINGS = [
  { value: 'open', label: 'Open', title: 'Ribs only, film covered' },
  { value: 'dbox', label: 'D-box', title: 'Sheeted from the leading edge back to the spar' },
  { value: 'sheeted', label: 'Fully sheeted' },
]
const SPACINGS = [
  { value: 'suggested', label: 'From loads', title: 'As close as the structure needs, no wider than the maximum' },
  { value: 'uniform', label: 'Even' },
  { value: 'tapered', label: 'Tapered' },
  { value: 'manual', label: 'Manual' },
]

const nextId = (list) => list.reduce((m, x) => Math.max(m, x.id ?? 0), 0) + 1
function addTo(path, item) {
  const list = path.split('.').reduce((o, k) => o[k], st.value) ?? []
  set(path, [...list, { id: nextId(list), ...item }])
}
function updateIn(path, itemId, key, value) {
  const list = path.split('.').reduce((o, k) => o[k], st.value)
  set(
    path,
    list.map((x) => (x.id === itemId ? { ...x, [key]: value } : x)),
  )
}
function removeFrom(path, itemId) {
  const list = path.split('.').reduce((o, k) => o[k], st.value)
  set(
    path,
    list.filter((x) => x.id !== itemId),
  )
}
const byDistance = (list) => [...(list ?? [])].sort((a, b) => (a.d ?? Infinity) - (b.d ?? Infinity))

const autoSparText = computed(() => (Number.isFinite(props.autoSpar) ? `${(props.autoSpar * 100).toFixed(1)} (thickest point)` : 'auto'))
const braceHint = computed(() => {
  const n = props.braceNeeds.filter(Number.isFinite)
  if (!n.length) return 'No dihedral breaks to brace.'
  return `Leave blank for the next standard ply thickness above what the bending needs (${n
    .map((v) => `${(v * 1000).toFixed(1)} mm`)
    .join(', ')}).`
})
</script>

<template>
  <div class="wc-structure-editor">
    <fieldset class="wc-panelset">
      <legend class="wc-panelset__legend">Design loads</legend>
      <ParamInput
        :id="id('g')"
        :model-value="st.loads.designG"
        label="Load factor"
        suffix="g"
        :min="2"
        :max="20"
        :step="0.5"
        hint="The most the wing should carry in a pull-up. Around 6 for sport flying, 10 or more for aerobatics or hard launches."
        @update:model-value="set('loads.designG', $event)"
      />
      <ParamInput
        :id="id('gneg')"
        :model-value="st.loads.negativeG"
        label="Negative load factor"
        suffix="g"
        :min="0"
        :max="20"
        :step="0.5"
        hint="Pushed or inverted flight. Half the positive figure is usual for sport models."
        @update:model-value="set('loads.negativeG', $event)"
      />
      <ParamInput
        :id="id('sf')"
        :model-value="st.loads.safetyFactor"
        label="Safety factor"
        suffix="×"
        :min="1"
        :max="3"
        :step="0.1"
        hint="Applied on top of the load factor. 1.5 is the aircraft standard."
        @update:model-value="set('loads.safetyFactor', $event)"
      />
    </fieldset>

    <fieldset class="wc-panelset">
      <legend class="wc-panelset__legend">Spar</legend>
      <SegmentedField :model-value="st.spar.type" label="Type" :options="SPAR_TYPES" @update:model-value="set('spar.type', $event)" />
      <UnitInput
        :id="id('sparpos')"
        :model-value="st.spar.position"
        quantity="percent"
        :system="system"
        label="Position along the chord"
        :placeholder="autoSparText"
        hint="Kept at this fraction of the chord at every panel end, and straight between them. Blank puts it at the section's thickest point."
        @update:model-value="set('spar.position', $event)"
      />
      <template v-if="st.spar.type === 'caps' || st.spar.type === 'box'">
        <UnitInput :id="id('capw')" :model-value="st.spar.capWidth" quantity="thin" :system="system" label="Cap width" @update:model-value="set('spar.capWidth', $event)" />
        <UnitInput
          :id="id('capt')"
          :model-value="st.spar.capThickness"
          quantity="thin"
          :system="system"
          label="Cap thickness"
          @update:model-value="set('spar.capThickness', $event)"
        />
        <SelectField :id="id('capm')" :model-value="st.spar.capMaterial" label="Cap material" :options="CAPS" @update:model-value="set('spar.capMaterial', $event)" />
        <UnitInput
          :id="id('webt')"
          :model-value="st.spar.webThickness"
          quantity="thin"
          :system="system"
          label="Shear web thickness"
          :hint="st.spar.type === 'box' ? 'Webs on both faces of the caps, fitted between the ribs.' : 'One web on the front face of the caps, fitted between the ribs, grain vertical.'"
          @update:model-value="set('spar.webThickness', $event)"
        />
        <SelectField :id="id('webm')" :model-value="st.spar.webMaterial" label="Web material" :options="SHEET" @update:model-value="set('spar.webMaterial', $event)" />
      </template>
      <template v-else-if="st.spar.type === 'tube'">
        <UnitInput :id="id('tubed')" :model-value="st.spar.tubeDiameter" quantity="thin" :system="system" label="Outside diameter" @update:model-value="set('spar.tubeDiameter', $event)" />
        <UnitInput :id="id('tubew')" :model-value="st.spar.tubeWall" quantity="thin" :system="system" label="Wall thickness" @update:model-value="set('spar.tubeWall', $event)" />
        <UnitInput
          :id="id('tubel')"
          :model-value="st.spar.tubeLength"
          quantity="length"
          :system="system"
          label="Length from the root rib"
          placeholder="to the tip"
          hint="A tube usually stops where the wing gets too thin for it; beyond that, ribs get no hole."
          @update:model-value="set('spar.tubeLength', $event)"
        />
        <SelectField :id="id('tubem')" :model-value="st.spar.tubeMaterial" label="Material" :options="TUBE" @update:model-value="set('spar.tubeMaterial', $event)" />
      </template>
      <template v-else>
        <UnitInput :id="id('solw')" :model-value="st.spar.solidWidth" quantity="thin" :system="system" label="Width" @update:model-value="set('spar.solidWidth', $event)" />
        <UnitInput :id="id('sold')" :model-value="st.spar.solidDepth" quantity="thin" :system="system" label="Depth" @update:model-value="set('spar.solidDepth', $event)" />
        <SelectField :id="id('solm')" :model-value="st.spar.solidMaterial" label="Material" :options="CAPS" @update:model-value="set('spar.solidMaterial', $event)" />
        <SegmentedField
          :model-value="st.spar.solidMount"
          label="Through the ribs"
          :options="[
            { value: 'through', label: 'Slot' },
            { value: 'top', label: 'Top notch' },
            { value: 'bottom', label: 'Bottom notch' },
          ]"
          @update:model-value="set('spar.solidMount', $event)"
        />
      </template>
    </fieldset>

    <fieldset class="wc-panelset">
      <legend class="wc-panelset__legend">Covering</legend>
      <SegmentedField :model-value="st.covering.type" label="Structure" :options="COVERINGS" @update:model-value="set('covering.type', $event)" />
      <template v-if="st.covering.type !== 'open'">
        <UnitInput
          :id="id('sheett')"
          :model-value="st.covering.sheetThickness"
          quantity="thin"
          :system="system"
          label="Sheeting thickness"
          @update:model-value="set('covering.sheetThickness', $event)"
        />
        <SelectField
          :id="id('sheetm')"
          :model-value="st.covering.sheetMaterial"
          label="Sheeting material"
          :options="SHEET"
          @update:model-value="set('covering.sheetMaterial', $event)"
        />
      </template>
      <template v-if="st.covering.type !== 'sheeted'">
        <label class="wc-check wc-structure-editor__check">
          <input type="checkbox" :checked="st.covering.capStrips" @change="set('covering.capStrips', $event.target.checked)" />
          Cap strips on the ribs{{ st.covering.type === 'dbox' ? ' behind the spar' : '' }}
        </label>
        <template v-if="st.covering.capStrips">
          <UnitInput
            :id="id('csw')"
            :model-value="st.covering.capStripWidth"
            quantity="thin"
            :system="system"
            label="Cap strip width"
            @update:model-value="set('covering.capStripWidth', $event)"
          />
          <UnitInput
            :id="id('cst')"
            :model-value="st.covering.capStripThickness"
            quantity="thin"
            :system="system"
            label="Cap strip thickness"
            @update:model-value="set('covering.capStripThickness', $event)"
          />
        </template>
      </template>
    </fieldset>

    <fieldset class="wc-panelset">
      <legend class="wc-panelset__legend">Leading and trailing edges</legend>
      <UnitInput
        :id="id('lew')"
        :model-value="st.le.width"
        quantity="thin"
        :system="system"
        label="Leading edge stock, depth along the chord"
        hint="The ribs are cut back by this much; the stock is glued on and carved to shape."
        @update:model-value="set('le.width', $event)"
      />
      <SelectField :id="id('lem')" :model-value="st.le.material" label="Leading edge material" :options="WOOD" @update:model-value="set('le.material', $event)" />
      <SegmentedField
        :model-value="st.te.type"
        label="Trailing edge stock"
        :options="[
          { value: 'triangular', label: 'Triangular' },
          { value: 'flat', label: 'Flat strip' },
        ]"
        @update:model-value="set('te.type', $event)"
      />
      <UnitInput
        :id="id('tew')"
        :model-value="st.te.width"
        quantity="thin"
        :system="system"
        label="Trailing edge stock, depth along the chord"
        @update:model-value="set('te.width', $event)"
      />
      <SelectField :id="id('tem')" :model-value="st.te.material" label="Trailing edge material" :options="WOOD" @update:model-value="set('te.material', $event)" />
    </fieldset>

    <fieldset class="wc-panelset">
      <legend class="wc-panelset__legend">Stringers and turbulator spars</legend>
      <div v-for="(s, k) in st.stringers" :key="s.id" class="wc-structure-editor__item">
        <div class="wc-structure-editor__itemhead">
          <span>Stringer {{ k + 1 }}</span>
          <button type="button" class="wc-stations__remove" :aria-label="`Remove stringer ${k + 1}`" @click="removeFrom('stringers', s.id)">×</button>
        </div>
        <UnitInput
          :id="id(`str${s.id}p`)"
          :model-value="s.position"
          quantity="percent"
          :system="system"
          label="Position along the chord"
          @update:model-value="updateIn('stringers', s.id, 'position', $event)"
        />
        <SegmentedField
          :model-value="s.surface"
          label="Surface"
          :options="[
            { value: 'upper', label: 'Top' },
            { value: 'lower', label: 'Bottom' },
            { value: 'both', label: 'Both' },
          ]"
          @update:model-value="updateIn('stringers', s.id, 'surface', $event)"
        />
        <div class="wc-structure-editor__pair">
          <UnitInput :id="id(`str${s.id}w`)" :model-value="s.width" quantity="thin" :system="system" label="Width" @update:model-value="updateIn('stringers', s.id, 'width', $event)" />
          <UnitInput :id="id(`str${s.id}h`)" :model-value="s.height" quantity="thin" :system="system" label="Height" @update:model-value="updateIn('stringers', s.id, 'height', $event)" />
        </div>
        <SelectField :id="id(`str${s.id}m`)" :model-value="s.material" label="Material" :options="CAPS" @update:model-value="updateIn('stringers', s.id, 'material', $event)" />
      </div>
      <p v-if="!st.stringers.length" class="wc-field__hint">
        None. A stringer on the top surface just behind the leading edge works as a turbulator spar, and stiffens D-box
        sheeting.
      </p>
      <button
        type="button"
        class="wc-button wc-button--small wc-structure-editor__add"
        @click="addTo('stringers', { position: 0.12, surface: 'upper', width: 0.003, height: 0.003, material: 'balsa-hard' })"
      >
        Add stringer
      </button>
    </fieldset>

    <fieldset class="wc-panelset">
      <legend class="wc-panelset__legend">Ribs</legend>
      <UnitInput :id="id('ribt')" :model-value="st.ribs.thickness" quantity="thin" :system="system" label="Rib thickness" @update:model-value="set('ribs.thickness', $event)" />
      <SelectField :id="id('ribm')" :model-value="st.ribs.material" label="Rib material" :options="WOOD" @update:model-value="set('ribs.material', $event)" />
      <SegmentedField
        :model-value="st.ribs.orientation"
        label="Rib direction"
        :options="[
          { value: 'streamwise', label: 'Streamwise' },
          { value: 'perpendicular', label: 'Square to the spar' },
        ]"
        :hint="
          st.ribs.orientation === 'perpendicular'
            ? 'The root, panel-break and tip ribs stay streamwise so the panels and fuselage meet cleanly.'
            : ''
        "
        @update:model-value="set('ribs.orientation', $event)"
      />
      <SegmentedField
        :model-value="st.ribs.rootJoint"
        label="Wing halves"
        :options="[
          { value: 'one-piece', label: 'One piece' },
          { value: 'two-piece', label: 'Two pieces' },
        ]"
        :hint="
          st.ribs.rootJoint === 'two-piece'
            ? 'Each half starts with a root rib at the fuselage side and plugs in; the joiner itself isn\'t designed here.'
            : 'Continuous through the centreline, with a centre rib shared by both halves.'
        "
        @update:model-value="set('ribs.rootJoint', $event)"
      />
      <SegmentedField :model-value="st.ribs.spacing" label="Spacing" :options="SPACINGS" @update:model-value="set('ribs.spacing', $event)" />
      <UnitInput
        v-if="st.ribs.spacing === 'suggested' || st.ribs.spacing === 'uniform'"
        :id="id('pitch')"
        :model-value="st.ribs.pitch"
        quantity="length"
        :system="system"
        :label="st.ribs.spacing === 'suggested' ? 'Most the ribs may be apart' : 'Rib spacing'"
        :hint="
          st.ribs.spacing === 'suggested'
            ? 'For the covering: film sags between ribs much over 75 mm. Closer where the loads need it.'
            : 'Each panel gets the fewest equal bays no wider than this.'
        "
        @update:model-value="set('ribs.pitch', $event)"
      />
      <div v-else-if="st.ribs.spacing === 'tapered'" class="wc-structure-editor__pair">
        <UnitInput :id="id('rootp')" :model-value="st.ribs.rootPitch" quantity="length" :system="system" label="At the root" @update:model-value="set('ribs.rootPitch', $event)" />
        <UnitInput :id="id('tipp')" :model-value="st.ribs.tipPitch" quantity="length" :system="system" label="At the tip" @update:model-value="set('ribs.tipPitch', $event)" />
      </div>
      <template v-else-if="st.ribs.spacing === 'manual'">
        <p class="wc-field__hint">Distances from the root rib. The root, panel ends, tip and hard points always get a rib.</p>
        <div v-for="(m, k) in byDistance(st.ribs.manual)" :key="m.id" class="wc-structure-editor__row">
          <UnitInput
            :id="id(`man${m.id}`)"
            :model-value="m.d"
            quantity="length"
            :system="system"
            :label="`Rib ${k + 1}`"
            @update:model-value="updateIn('ribs.manual', m.id, 'd', $event)"
          />
          <button type="button" class="wc-stations__remove" :aria-label="`Remove rib ${k + 1}`" @click="removeFrom('ribs.manual', m.id)">×</button>
        </div>
        <button type="button" class="wc-button wc-button--small wc-structure-editor__add" @click="addTo('ribs.manual', { d: null })">Add rib</button>
      </template>

      <div class="wc-structure-editor__sub">
        <span class="wc-field__label">Hard points</span>
        <p class="wc-field__hint">Ribs that must be at a set distance from the root rib: servo bays, aileron ends, undercarriage.</p>
        <div v-for="h in byDistance(st.ribs.hardPoints)" :key="h.id" class="wc-structure-editor__row">
          <UnitInput
            :id="id(`hp${h.id}d`)"
            :model-value="h.d"
            quantity="length"
            :system="system"
            label="Distance"
            @update:model-value="updateIn('ribs.hardPoints', h.id, 'd', $event)"
          />
          <div class="wc-field">
            <label :for="id(`hp${h.id}l`)" class="wc-field__label">What</label>
            <input
              :id="id(`hp${h.id}l`)"
              class="wc-input"
              type="text"
              :value="h.label"
              placeholder="e.g. Servo bay"
              @change="updateIn('ribs.hardPoints', h.id, 'label', $event.target.value)"
            />
          </div>
          <button type="button" class="wc-stations__remove" aria-label="Remove hard point" @click="removeFrom('ribs.hardPoints', h.id)">×</button>
        </div>
        <button type="button" class="wc-button wc-button--small wc-structure-editor__add" @click="addTo('ribs.hardPoints', { d: null, label: '' })">
          Add hard point
        </button>
      </div>

      <label class="wc-check wc-structure-editor__check">
        <input type="checkbox" :checked="st.ribs.lightening" @change="set('ribs.lightening', $event.target.checked)" />
        Lightening holes (not in the root, break or tip ribs)
      </label>
      <UnitInput
        v-if="st.ribs.lightening"
        :id="id('lhm')"
        :model-value="st.ribs.lighteningMargin"
        quantity="thin"
        :system="system"
        label="Material left around each hole"
        @update:model-value="set('ribs.lighteningMargin', $event)"
      />
      <label class="wc-check wc-structure-editor__check">
        <input type="checkbox" :checked="st.ribs.jigTabs" @change="set('ribs.jigTabs', $event.target.checked)" />
        Jig tabs to build on a flat board
      </label>
      <template v-if="st.ribs.jigTabs">
        <p class="wc-field__hint">
          Every rib in a panel gets feet down to one flat line, so the washout builds itself in. Cut them off once the
          panel is together.
        </p>
        <div class="wc-structure-editor__pair">
          <UnitInput :id="id('tabw')" :model-value="st.ribs.tabWidth" quantity="thin" :system="system" label="Tab width" @update:model-value="set('ribs.tabWidth', $event)" />
          <UnitInput
            :id="id('tabc')"
            :model-value="st.ribs.tabClearance"
            quantity="thin"
            :system="system"
            label="Least height"
            @update:model-value="set('ribs.tabClearance', $event)"
          />
        </div>
      </template>
    </fieldset>

    <fieldset class="wc-panelset">
      <legend class="wc-panelset__legend">Corner gussets</legend>
      <label class="wc-check wc-structure-editor__check">
        <input type="checkbox" :checked="st.gussets.le" @change="set('gussets.le', $event.target.checked)" /> Where ribs meet the leading edge
      </label>
      <label class="wc-check wc-structure-editor__check">
        <input type="checkbox" :checked="st.gussets.te" @change="set('gussets.te', $event.target.checked)" /> Where ribs meet the trailing edge
      </label>
      <template v-if="st.gussets.le || st.gussets.te">
        <SegmentedField
          :model-value="st.gussets.where"
          label="On"
          :options="[
            { value: 'ends', label: 'Root, breaks and tip' },
            { value: 'all', label: 'Every rib' },
          ]"
          @update:model-value="set('gussets.where', $event)"
        />
        <SegmentedField
          :model-value="st.gussets.sides"
          label="Sides of each rib"
          :options="[
            { value: 'both', label: 'Both' },
            { value: 'one', label: 'Outboard only' },
          ]"
          @update:model-value="set('gussets.sides', $event)"
        />
        <div class="wc-structure-editor__pair">
          <UnitInput :id="id('gsz')" :model-value="st.gussets.size" quantity="thin" :system="system" label="Leg length" @update:model-value="set('gussets.size', $event)" />
          <UnitInput :id="id('gt')" :model-value="st.gussets.thickness" quantity="thin" :system="system" label="Thickness" @update:model-value="set('gussets.thickness', $event)" />
        </div>
        <SelectField :id="id('gm')" :model-value="st.gussets.material" label="Material" :options="SHEET" @update:model-value="set('gussets.material', $event)" />
      </template>
    </fieldset>

    <fieldset class="wc-panelset">
      <legend class="wc-panelset__legend">Dihedral braces</legend>
      <label class="wc-check wc-structure-editor__check">
        <input type="checkbox" :checked="st.braces.enabled" @change="set('braces.enabled', $event.target.checked)" />
        Brace plates on the spar at each dihedral break
      </label>
      <template v-if="st.braces.enabled">
        <p v-if="st.spar.type === 'tube'" class="wc-field__hint">A tube spar joins with a bent joiner or sleeve instead, so no plates are drawn.</p>
        <SelectField :id="id('bm')" :model-value="st.braces.material" label="Material" :options="PLY" @update:model-value="set('braces.material', $event)" />
        <UnitInput
          :id="id('bt')"
          :model-value="st.braces.thickness"
          quantity="thin"
          :system="system"
          label="Thickness"
          placeholder="auto"
          :hint="braceHint"
          @update:model-value="set('braces.thickness', $event)"
        />
        <UnitInput
          :id="id('bl')"
          :model-value="st.braces.length"
          quantity="length"
          :system="system"
          label="Length each side of the break"
          @update:model-value="set('braces.length', $event)"
        />
      </template>
    </fieldset>
  </div>
</template>
