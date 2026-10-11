<script setup>
// Export options and downloads: the parts laid out for cutting (DXF), a full-size plan
// (DXF) and a cut list (CSV). Options are kept with the project, so a re-export comes out
// the same. Rib details that change the parts themselves (lightening holes, jig tabs) are
// shared with the structure editor.
import { computed } from 'vue'
import { zipSync, strToU8 } from 'fflate'
import UnitInput from './UnitInput.vue'
import SegmentedField from './SegmentedField.vue'
import { layoutParts, partsDxf, planDxf, cutListCsv } from '../lib/dxf.js'
import { bounds } from '../lib/ribs.js'

const props = defineProps({
  analysis: { type: Object, required: true },
  parts: { type: Array, required: true },
  cutList: { type: Array, required: true },
  system: { type: String, required: true },
  baseName: { type: String, default: 'wing' },
})
const emit = defineEmits(['close'])
const options = defineModel('options', { type: Object, required: true })
const structure = defineModel('structure', { type: Object, required: true })

const o = computed(() => options.value)
function set(path, value) {
  const keys = path.split('.')
  const copy = (obj, i) => ({ ...obj, [keys[i]]: i === keys.length - 1 ? value : copy(obj[keys[i]], i + 1) })
  options.value = copy(options.value, 0)
}
function setRibs(key, value) {
  structure.value = { ...structure.value, ribs: { ...structure.value.ribs, [key]: value } }
}

const GROUPS = [
  { id: 'ribs', label: 'Ribs' },
  { id: 'gussets', label: 'Corner gussets' },
  { id: 'braces', label: 'Dihedral braces' },
  { id: 'webs', label: 'Shear webs' },
  { id: 'sheeting', label: 'Sheeting templates (approximate)' },
  { id: 'tip', label: 'Tip block template' },
]
const present = computed(() => GROUPS.filter((g) => props.parts.some((p) => p.group === g.id)))
const count = (id) => props.parts.filter((p) => p.group === id).reduce((n, p) => n + p.qty, 0)

const layout = computed(() => layoutParts(props.parts, o.value))
const preview = computed(() => {
  const groups = layout.value.groups
  let y = 0
  const lines = []
  for (const g of groups) {
    for (const e of g.entities) if (e.type === 'poly') lines.push({ layer: e.layer, pts: e.pts.map(([x, py]) => [x, py + y]), closed: e.closed })
    y -= g.height + 25
  }
  if (!lines.length) return null
  const b = bounds(lines.flatMap((l) => l.pts))
  const pad = 10
  return {
    box: `${b.x0 - pad} ${-b.y1 - pad} ${b.w + 2 * pad} ${b.h + 2 * pad}`,
    lines: lines.map((l) => ({ ...l, d: l.pts.map(([x, py]) => `${x.toFixed(2)},${(-py).toFixed(2)}`).join(' ') })),
    size: `${Math.round(b.w)} × ${Math.round(b.h)} mm`,
  }
})

function save(name, data, type) {
  const blob = new Blob([data], { type })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
function downloadParts() {
  const files = partsDxf(props.parts, o.value, props.baseName)
  if (files.length === 1) save(files[0].name, files[0].text, 'application/dxf')
  else save(`${props.baseName}-parts.zip`, zipSync(Object.fromEntries(files.map((f) => [f.name, strToU8(f.text)]))), 'application/zip')
}
function downloadPlan() {
  const f = planDxf(props.analysis, structure.value, props.parts, o.value, props.baseName)
  save(f.name, f.text, 'application/dxf')
}
function downloadCutList() {
  save(`${props.baseName}-cut-list.csv`, cutListCsv(props.parts, props.cutList), 'text/csv')
}
</script>

<template>
  <section class="wc-export" role="dialog" aria-label="Export">
    <header class="wc-export__head">
      <h3 class="wc-card__label">Export for cutting</h3>
      <button type="button" class="wc-button" @click="emit('close')">Close</button>
    </header>
    <div class="wc-export__body">
      <div class="wc-export__options">
        <fieldset class="wc-panelset">
          <legend class="wc-panelset__legend">Parts</legend>
          <label v-for="g in present" :key="g.id" class="wc-check wc-structure-editor__check">
            <input type="checkbox" :checked="o.parts[g.id] !== false" @change="set(`parts.${g.id}`, $event.target.checked)" />
            {{ g.label }} <span class="wc-muted">({{ count(g.id) }})</span>
          </label>
          <SegmentedField
            :model-value="o.handedness"
            label="For"
            :options="[
              { value: 'pair', label: 'Both halves' },
              { value: 'right', label: 'Right half' },
              { value: 'left', label: 'Left half' },
            ]"
            hint="Ribs are the same for either side; the plan is mirrored for the left. A pair doubles every quantity except parts on the centreline."
            @update:model-value="set('handedness', $event)"
          />
        </fieldset>

        <fieldset class="wc-panelset">
          <legend class="wc-panelset__legend">Rib details</legend>
          <label class="wc-check wc-structure-editor__check">
            <input type="checkbox" :checked="structure.ribs.lightening" @change="setRibs('lightening', $event.target.checked)" />
            Lightening holes
          </label>
          <UnitInput
            v-if="structure.ribs.lightening"
            id="wcx-lhm"
            :model-value="structure.ribs.lighteningMargin"
            quantity="thin"
            :system="system"
            label="Material left around each hole"
            @update:model-value="setRibs('lighteningMargin', $event)"
          />
          <label class="wc-check wc-structure-editor__check">
            <input type="checkbox" :checked="structure.ribs.jigTabs" @change="setRibs('jigTabs', $event.target.checked)" />
            Jig tabs down to a flat board
          </label>
          <div v-if="structure.ribs.jigTabs" class="wc-structure-editor__pair">
            <UnitInput id="wcx-tabw" :model-value="structure.ribs.tabWidth" quantity="thin" :system="system" label="Tab width" @update:model-value="setRibs('tabWidth', $event)" />
            <UnitInput
              id="wcx-tabc"
              :model-value="structure.ribs.tabClearance"
              quantity="thin"
              :system="system"
              label="Least height"
              @update:model-value="setRibs('tabClearance', $event)"
            />
          </div>
        </fieldset>

        <fieldset class="wc-panelset">
          <legend class="wc-panelset__legend">Machine</legend>
          <SegmentedField
            :model-value="o.machine"
            label="Cutting with"
            :options="[
              { value: 'laser', label: 'Laser' },
              { value: 'router', label: 'CNC router' },
            ]"
            @update:model-value="set('machine', $event)"
          />
          <UnitInput
            v-if="o.machine === 'laser'"
            id="wcx-kerf"
            :model-value="o.kerf"
            quantity="thin"
            :system="system"
            label="Kerf (width of the cut)"
            hint="Each cut moves half of this into the waste, so parts come out true size. 0 if your laser software compensates."
            @update:model-value="set('kerf', $event ?? 0)"
          />
          <template v-else>
            <UnitInput
              id="wcx-tool"
              :model-value="o.toolDiameter"
              quantity="thin"
              :system="system"
              label="Cutter diameter"
              @update:model-value="set('toolDiameter', $event)"
            />
            <label class="wc-check wc-structure-editor__check">
              <input type="checkbox" :checked="o.dogbones" @change="set('dogbones', $event.target.checked)" />
              Dogbones in inside corners, so square spar caps fit
            </label>
            <label class="wc-check wc-structure-editor__check">
              <input type="checkbox" :checked="o.toolOffset" @change="set('toolOffset', $event.target.checked)" />
              Offset the paths by the cutter radius (leave off if your CAM does it)
            </label>
          </template>
        </fieldset>

        <fieldset class="wc-panelset">
          <legend class="wc-panelset__legend">Drawing</legend>
          <SegmentedField
            :model-value="o.format"
            label="Shapes as"
            :options="[
              { value: 'polyline', label: 'Polylines' },
              { value: 'lines', label: 'Separate lines' },
            ]"
            hint="R12 DXF in millimetres. Separate lines suit older software that doesn't read polylines."
            @update:model-value="set('format', $event)"
          />
          <label class="wc-check wc-structure-editor__check">
            <input type="checkbox" :checked="o.labels" @change="set('labels', $event.target.checked)" /> Label parts (R1, G2 …)
          </label>
          <SegmentedField
            v-if="o.labels"
            :model-value="o.labelStyle"
            label="Labels as"
            :options="[
              { value: 'strokes', label: 'Vector lines' },
              { value: 'text', label: 'DXF text' },
            ]"
            hint="Vector lines etch the same in any software; DXF text depends on its fonts."
            @update:model-value="set('labelStyle', $event)"
          />
          <div class="wc-export__layers">
            <div v-for="k in ['cut', 'etch', 'guide']" :key="k" class="wc-field">
              <label :for="`wcx-layer-${k}`" class="wc-field__label">{{ { cut: 'Cut layer', etch: 'Etch layer', guide: 'Notes layer' }[k] }}</label>
              <input
                :id="`wcx-layer-${k}`"
                class="wc-input"
                type="text"
                :value="o.layers[k]"
                @change="set(`layers.${k}`, $event.target.value.trim() || { cut: 'CUT', etch: 'ETCH', guide: 'GUIDE' }[k])"
              />
            </div>
          </div>
        </fieldset>

        <fieldset class="wc-panelset">
          <legend class="wc-panelset__legend">Layout</legend>
          <label class="wc-check wc-structure-editor__check">
            <input type="checkbox" :checked="o.repeat" @change="set('repeat', $event.target.checked)" /> One copy of each part per piece needed
          </label>
          <div class="wc-structure-editor__pair">
            <UnitInput id="wcx-row" :model-value="o.rowLength" quantity="length" :system="system" label="Sheet length" @update:model-value="set('rowLength', $event)" />
            <UnitInput id="wcx-gap" :model-value="o.gap" quantity="thin" :system="system" label="Gap between parts" @update:model-value="set('gap', $event ?? 0)" />
          </div>
          <label class="wc-check wc-structure-editor__check">
            <input type="checkbox" :checked="o.split" @change="set('split', $event.target.checked)" /> One file per material and thickness (zipped)
          </label>
          <p class="wc-field__hint">
            Parts are laid in rows grouped by stock, with the grain left to right along the sheet (shear webs are turned so
            theirs runs up the web).
          </p>
        </fieldset>
      </div>

      <div class="wc-export__preview">
        <svg v-if="preview" :viewBox="preview.box" preserveAspectRatio="xMidYMin meet" role="img" aria-label="Cutting layout preview">
          <polyline
            v-for="(l, i) in preview.lines"
            :key="i"
            :points="l.d + (l.closed ? ' ' + l.d.split(' ')[0] : '')"
            :class="`wc-export__${l.layer}`"
          />
        </svg>
        <p v-else class="wc-muted">Nothing chosen to export.</p>
        <p v-if="preview" class="wc-field__hint">Layout {{ preview.size }}: red cuts, blue etches, grey notes.</p>
        <ul v-if="layout.notes.length" class="wc-warnings">
          <li v-for="(n, i) in layout.notes" :key="i">{{ n }}</li>
        </ul>
        <div class="wc-export__actions">
          <button type="button" class="wc-button wc-button--primary" :disabled="!preview" @click="downloadParts">Download parts (DXF)</button>
          <button type="button" class="wc-button" @click="downloadPlan">Download plan (DXF)</button>
          <button type="button" class="wc-button" @click="downloadCutList">Download cut list (CSV)</button>
        </div>
      </div>
    </div>
  </section>
</template>
