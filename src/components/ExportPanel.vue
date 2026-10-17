<script setup>
// Export options and downloads: the parts laid out for cutting (DXF), a full-size plan
// (DXF) and a cut list (CSV). Options are kept with the project, so a re-export comes out
// the same. Rib details that change the parts themselves (lightening holes, jig tabs) are set
// in the structure editor; this only names them. A foam wing adds its hot-wire templates (with
// the wire's kerf and lead-in set here), skins and pocket routing templates, and a download of
// the templates on their own.
import { computed, ref, onMounted } from 'vue'
import { zipSync, strToU8 } from 'fflate'
import UnitInput from './UnitInput.vue'
import SegmentedField from './SegmentedField.vue'
import InspectorSection from './InspectorSection.vue'
import { layoutParts, partsDxf, planDxf, cutListCsv, partsDrawing, planEntities, templatesDxf } from '../lib/dxf.js'
import { drawingPdf, tiling, PAPERS } from '../lib/pdf.js'
import { bounds } from '../lib/ribs.js'

const props = defineProps({
  analysis: { type: Object, required: true },
  parts: { type: Array, required: true },
  cutList: { type: Array, required: true },
  system: { type: [String, Object], required: true }, // a units setting (units.js normaliseUnits) or system name
  baseName: { type: String, default: 'wing' },
  projectName: { type: String, default: 'Untitled' },
})
const emit = defineEmits(['close'])
const options = defineModel('options', { type: Object, required: true })

const o = computed(() => options.value)
const dialogEl = ref(null)
onMounted(() => dialogEl.value?.focus({ preventScroll: true }))
function set(path, value) {
  const keys = path.split('.')
  const copy = (obj, i) => ({ ...obj, [keys[i]]: i === keys.length - 1 ? value : copy(obj[keys[i]], i + 1) })
  options.value = copy(options.value, 0)
}

const GROUPS = [
  { id: 'ribs', label: 'Ribs' },
  { id: 'surfaces', label: 'Control surface ribs' },
  { id: 'hinges', label: 'Mylar hinge tabs' },
  { id: 'servos', label: 'Servo mount plates and hatches' },
  { id: 'brakes', label: 'Air brake boxes, blades and spoilers' },
  { id: 'gussets', label: 'Corner gussets' },
  { id: 'braces', label: 'Dihedral braces' },
  { id: 'webs', label: 'Shear webs' },
  { id: 'sheeting', label: 'Sheeting templates (approximate)' },
  { id: 'tip', label: 'Tip block template' },
  { id: 'templates', label: 'Hot-wire templates' },
  { id: 'skins', label: 'Skins (approximate)' },
  { id: 'pockets', label: 'Pocket routing templates' },
]
const foam = computed(() => props.analysis.construction === 'foam')
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

// One line per section, shown on its heading while it's closed
const fmtThin = (v) => `${Number((v * 1000).toFixed(2))} mm`
// Rib details are structure decisions (weight, 3D, plan), so they're set in the editor
const ribDetails = computed(() => {
  if (foam.value) return 'The hot-wire templates allow for the wire\'s kerf below; the other templates are cut true size.'
  const r = props.analysis.structure.ribs
  const on = [r.lightening && 'lightening holes', r.jigTabs && 'jig tabs'].filter(Boolean)
  return on.length ? `Ribs have ${on.join(' and ')}.` : 'Ribs are plain: no lightening holes or jig tabs.'
})
const summaries = computed(() => {
  const x = o.value
  const on = present.value.filter((g) => x.parts[g.id] !== false).length
  return {
    parts: `${on} of ${present.value.length} kinds, ${{ pair: 'both halves', right: 'right half', left: 'left half' }[x.handedness]}`,
    machine: x.machine === 'laser' ? `Laser, ${fmtThin(x.kerf || 0)} kerf` : `Router, ${fmtThin(x.toolDiameter)} cutter${x.dogbones ? ', dogbones' : ''}`,
    drawing: `${x.format === 'lines' ? 'Lines' : 'Polylines'}, ${x.labels ? 'labelled' : 'no labels'}`,
    layout: `${x.repeat ? 'Every piece' : 'One of each'}, ${Math.round(x.rowLength * 1000)} mm rows${x.split ? ', split' : ''}`,
    wire: `${fmtThin(x.wireKerf ?? 0.001)} kerf, ${fmtThin(x.leadIn ?? 0.02)} lead-in`,
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
function downloadTemplates() {
  const f = templatesDxf(props.parts, o.value, props.baseName)
  save(f.name, f.text, 'application/dxf')
}
function downloadPlan() {
  const f = planDxf(props.analysis, props.analysis.structure, props.parts, o.value, props.baseName)
  save(f.name, f.text, 'application/dxf')
}
// Printed templates: true outlines (no kerf or dogbones), 1:1 on the paper chosen
const printOpts = computed(() => ({ ...o.value, machine: 'laser', kerf: 0, dogbones: false, toolOffset: false }))
const printDrawings = computed(() => ({
  parts: partsDrawing(props.parts, printOpts.value),
  templates: foam.value ? templatesDxf(props.parts, printOpts.value).entities : [],
  plan: planEntities(props.analysis, props.analysis.structure, props.parts, { handedness: o.value.handedness }),
}))
const sheets = (ents) => {
  const pts = ents.flatMap((e) => (e.type === 'text' ? [[e.x, e.y]] : e.pts))
  if (!pts.length) return 0
  const b = bounds(pts)
  const t = tiling(b.w, b.h, o.value.pdfPaper ?? 'a4')
  return t.cols * t.rows
}
const sheetCount = computed(() => ({ parts: sheets(printDrawings.value.parts), plan: sheets(printDrawings.value.plan), templates: sheets(printDrawings.value.templates) }))
function downloadPdf(which) {
  const drawing =
    which === 'parts'
      ? 'Parts, true size (no kerf allowance)'
      : which === 'templates'
        ? 'Hot-wire templates, with the wire kerf allowance'
        : `Plan, ${{ right: 'right half', left: 'left half', pair: 'both halves' }[o.value.handedness] ?? 'right half'}`
  const pdf = drawingPdf(printDrawings.value[which], { paper: o.value.pdfPaper ?? 'a4', project: props.projectName, drawing })
  save(`${props.baseName}-${which}.pdf`, pdf, 'application/pdf')
}
function downloadCutList() {
  save(`${props.baseName}-cut-list.csv`, cutListCsv(props.parts, props.cutList), 'text/csv')
}
</script>

<template>
  <div class="wc-export__backdrop" @pointerdown.self="emit('close')">
  <section
    ref="dialogEl"
    class="wc-export"
    role="dialog"
    aria-modal="true"
    aria-label="Export for cutting"
    tabindex="-1"
    @keydown.esc.stop.prevent="emit('close')"
  >
    <header class="wc-export__head">
      <h3 class="wc-export__title">Export for cutting</h3>
      <button type="button" class="wc-button" @click="emit('close')">Close</button>
    </header>
    <div class="wc-export__body">
      <div class="wc-export__options wc-inspector">
        <InspectorSection title="Parts" fold-key="export:parts" :summary="summaries.parts" open>
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
            :hint="foam ? 'Parts are the same for either side (one pair of hot-wire templates cuts both halves); the plan is mirrored for the left. A pair doubles every other quantity except parts on the centreline.' : 'Ribs are the same for either side; the plan is mirrored for the left. A pair doubles every quantity except parts on the centreline.'"
            @update:model-value="set('handedness', $event)"
          />
          <p class="wc-field__hint">{{ ribDetails }}<template v-if="!foam"> Change these in the structure editor, under Ribs.</template></p>
        </InspectorSection>

        <InspectorSection title="Machine" fold-key="export:machine" :summary="summaries.machine" open>
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
        </InspectorSection>

        <InspectorSection v-if="foam" title="Hot wire" fold-key="export:wire" :summary="summaries.wire" open>
          <UnitInput
            id="wcx-wire-kerf"
            :model-value="o.wireKerf ?? 0.001"
            quantity="thin"
            :system="system"
            label="Wire kerf (width of the cut)"
            hint="The templates are half this bigger all round than the core, so it comes out true size. Measure it from a test cut in the same foam at the same heat and speed."
            @update:model-value="set('wireKerf', $event ?? 0)"
          />
          <UnitInput
            id="wcx-lead-in"
            :model-value="o.leadIn ?? 0.02"
            quantity="thin"
            :system="system"
            label="Lead-in and lead-out"
            hint="The wire's straight run into the block at the trailing edge and out at the front, drawn on the notes layer."
            @update:model-value="set('leadIn', $event ?? 0)"
          />
        </InspectorSection>

        <InspectorSection title="Drawing" fold-key="export:drawing" :summary="summaries.drawing" open>
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
          <div v-for="k in ['cut', 'etch', 'guide']" :key="k" class="wc-field">
            <label :for="`wcx-layer-${k}`" class="wc-field__label">{{ { cut: 'Cut layer', etch: 'Engrave layer', guide: 'Notes layer' }[k] }}</label>
            <div class="wc-field__control">
              <input
                :id="`wcx-layer-${k}`"
                class="wc-input"
                type="text"
                :value="o.layers[k]"
                @change="set(`layers.${k}`, $event.target.value.trim() || { cut: 'CUT', etch: 'ENGRAVE', guide: 'GUIDE' }[k])"
              />
            </div>
          </div>
        </InspectorSection>

        <InspectorSection title="Layout" fold-key="export:layout" :summary="summaries.layout" open>
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
        </InspectorSection>
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
        <p v-if="preview" class="wc-field__hint">Layout {{ preview.size }}: red cuts, blue engraving, grey notes.</p>
        <ul v-if="layout.notes.length" class="wc-warnings">
          <li v-for="(n, i) in layout.notes" :key="i">{{ n }}</li>
        </ul>
        <div class="wc-export__actions">
          <button type="button" class="wc-button wc-button--primary" :disabled="!preview" @click="downloadParts">Download parts (DXF)</button>
          <button v-if="foam" type="button" class="wc-button" @click="downloadTemplates">Download hot-wire templates (DXF)</button>
          <button type="button" class="wc-button" @click="downloadPlan">Download plan (DXF)</button>
          <button type="button" class="wc-button" @click="downloadCutList">Download cut list (CSV)</button>
        </div>
        <div class="wc-export__print">
          <h4 class="wc-export__subtitle">Printed templates (PDF, 1:1)</h4>
          <p class="wc-field__hint">
            To build over or cut round by hand: true size, with a title block and a 50 mm bar on every sheet to check the
            print. Print at 100% (actual size). Larger drawings are split across sheets that overlap by 10 mm, each named
            (A1, A2 …) with its neighbours marked on its edges.
          </p>
          <div class="wc-export__printrow">
            <label class="wc-field__label" for="wcx-paper">Paper</label>
            <select id="wcx-paper" class="wc-input wc-select wc-select--small" :value="o.pdfPaper ?? 'a4'" @change="set('pdfPaper', $event.target.value)">
              <option v-for="(p, k) in PAPERS" :key="k" :value="k">{{ p.label }}</option>
            </select>
            <button type="button" class="wc-button" :disabled="!sheetCount.parts" @click="downloadPdf('parts')">
              Parts (PDF, {{ sheetCount.parts }} sheet{{ sheetCount.parts === 1 ? '' : 's' }})
            </button>
            <button v-if="foam" type="button" class="wc-button" :disabled="!sheetCount.templates" @click="downloadPdf('templates')">
              Templates (PDF, {{ sheetCount.templates }} sheet{{ sheetCount.templates === 1 ? '' : 's' }})
            </button>
            <button type="button" class="wc-button" @click="downloadPdf('plan')">
              Plan (PDF, {{ sheetCount.plan }} sheet{{ sheetCount.plan === 1 ? '' : 's' }})
            </button>
          </div>
        </div>
      </div>
    </div>
  </section>
  </div>
</template>
