<script setup>
import { ref, reactive, computed, shallowRef, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import UnitInput from './components/UnitInput.vue'
import AirfoilPicker from './components/AirfoilPicker.vue'
import SectionView from './components/SectionView.vue'
import PlanformView from './components/PlanformView.vue'
import PanelEditor from './components/PanelEditor.vue'
import WingPlanEditor from './components/WingPlanEditor.vue'
import ProjectBar from './components/ProjectBar.vue'
import UndoRedo from './components/UndoRedo.vue'
import WingWorkspace from './components/WingWorkspace.vue'
import InspectorSection from './components/InspectorSection.vue'
import { useHistory } from './composables/useHistory.js'
import { usePolarSolver } from './composables/usePolarSolver.js'
import LiftCurve from './components/LiftCurve.vue'
import SpanLiftChart from './components/SpanLiftChart.vue'
import StructureEditor from './components/StructureEditor.vue'
import StructurePlan from './components/StructurePlan.vue'
import Structure3D from './components/Structure3D.vue'
import LoadsChart from './components/LoadsChart.vue'
import PartPreview from './components/PartPreview.vue'
import ExportPanel from './components/ExportPanel.vue'
import { analyseStructure, sparFraction, MODES, MATERIALS } from './lib/structure.js'
import { buildParts } from './lib/ribs.js'
import { SYSTEMS, format, defaultUnit, otherSystem } from './lib/units.js'
import {
  wingGeometry,
  wingLoading,
  cubeLoading,
  cubeBand,
  validate,
  CUBE_BANDS,
  WING_CLMAX_FACTOR,
  RHO_SEA_LEVEL,
} from './lib/calc.js'
import { resolveAirfoil, performanceWithXfoil, loadCatalogue } from './lib/airfoils.js'
import { XFOIL_SETTINGS, coordsKey, settingsKey } from './lib/xfoil.js'
import {
  defaultState,
  browserStorage,
  listProjects,
  saveProject,
  loadProject,
  deleteProject,
  findByName,
  writeAutosave,
  readAutosave,
  exportProject,
  importProject,
  fileName,
} from './lib/projects.js'
import { RATINGS } from './lib/stall.js'
import { panelSections, wingSampler, projectedSampler } from './lib/wing.js'
import { scaleThickness } from './lib/airfoilGeom.js'

const props = defineProps({
  units: { type: String, default: 'metric' },
  theme: { type: String, default: 'auto' }, // initial theme: 'auto' follows the OS, or 'light' / 'dark'
})
const emit = defineEmits(['theme-change'])

// Colour theme. The viewer's choice is remembered in this browser (a per-viewer
// preference, so it isn't part of a project).
const THEMES = [
  { id: 'auto', label: 'Auto', title: 'Follow the system light or dark setting' },
  { id: 'light', label: 'Light', title: 'Always light' },
  { id: 'dark', label: 'Dark', title: 'Always dark' },
]
const THEME_KEY = 'wingcalc.theme'
const validTheme = (t) => (THEMES.some((x) => x.id === t) ? t : null)
let savedTheme = null
try {
  savedTheme = validTheme(globalThis.localStorage?.getItem(THEME_KEY))
} catch {
  // storage blocked: fall back to the host's choice
}
const themeMode = ref(savedTheme ?? validTheme(props.theme) ?? 'auto')
watch(
  themeMode,
  (t) => {
    try {
      globalThis.localStorage?.setItem(THEME_KEY, t)
    } catch {
      // not remembered; fine
    }
    emit('theme-change', t)
  },
  { immediate: true },
)

// --- State and projects ------------------------------------------------------------------

// The working state restores from the last session's autosave if there is one; otherwise a
// new project (a typical 1.4 m sport model), in the units the host page asked for.
const storage = browserStorage()
const restored = readAutosave(storage)
const start = restored?.state ?? { ...defaultState(), units: SYSTEMS[props.units] ? props.units : 'metric' }

const system = ref(start.units)
const alt = computed(() => otherSystem(system.value))
const u = (q, s = system.value) => defaultUnit(s, q)

// All values in SI base units.
const input = reactive({ ...start.input })
const airfoilSel = ref(start.airfoil)

const currentState = () => ({ units: system.value, input: { ...input }, airfoil: airfoilSel.value })
const snapshot = () => JSON.stringify(currentState())

// The saved project the restored work belongs to, if it still exists.
const restoredFrom = restored?.projectId ? loadProject(storage, restored.projectId) : null
const project = reactive({ id: restoredFrom?.id ?? null, name: restored?.name ?? '' })
const projects = ref(listProjects(storage))
// What was last saved or opened, to tell whether there are unsaved changes. Restored work
// that was never saved compares against a blank project.
const blank = () => JSON.stringify({ ...defaultState(), units: system.value })
const savedSnapshot = ref(restoredFrom ? JSON.stringify(restoredFrom.state) : restored ? blank() : snapshot())
const savedName = ref(restoredFrom?.name ?? '')
const dirty = computed(() => snapshot() !== savedSnapshot.value || project.name.trim() !== savedName.value)
const status = ref('')
let statusTimer = null
function say(text) {
  status.value = text
  clearTimeout(statusTimer)
  statusTimer = setTimeout(() => (status.value = ''), 3000)
}

function applyState(state) {
  system.value = state.units
  for (const k of Object.keys(input)) delete input[k]
  Object.assign(input, state.input)
  airfoilSel.value = state.airfoil
  selectedPanel.value = null
  // Opening a project shouldn't be undoable back into the previous one.
  queueMicrotask(() => history.reset())
}

function refreshList() {
  projects.value = listProjects(storage)
}

function save({ copy = false } = {}) {
  let id = copy ? null : project.id
  let name = project.name.trim() || 'Untitled'
  if (copy) name = `${name} copy`
  if (!id) {
    const existing = findByName(storage, name)
    if (existing && !window.confirm(`Replace the saved project "${existing.name}"?`)) return
    id = existing?.id ?? null
  }
  const res = saveProject(storage, { id, name, state: currentState() })
  if (!res.ok) {
    say("Couldn't save: storage is full or blocked. Try Export instead.")
    return
  }
  project.id = res.id
  project.name = name
  savedName.value = name
  savedSnapshot.value = snapshot()
  refreshList()
  say(`Saved "${name}"`)
}

function confirmDiscard() {
  return !dirty.value || window.confirm('Discard unsaved changes to this project?')
}

function open(id) {
  if (id === project.id && !dirty.value) return
  if (!confirmDiscard()) return
  const p = loadProject(storage, id)
  if (!p) {
    say("That project couldn't be read.")
    refreshList()
    return
  }
  applyState(p.state)
  project.id = p.id
  project.name = p.name
  savedName.value = p.name
  savedSnapshot.value = snapshot()
  say(`Opened "${p.name}"`)
}

function remove(id) {
  const p = projects.value.find((q) => q.id === id)
  if (!p || !window.confirm(`Delete the saved project "${p.name}"? This can't be undone.`)) return
  deleteProject(storage, id)
  if (project.id === id) project.id = null
  refreshList()
  say(`Deleted "${p.name}"`)
}

function newProject() {
  if (!confirmDiscard()) return
  const state = { ...defaultState(), units: system.value }
  applyState(state)
  project.id = null
  project.name = ''
  savedName.value = ''
  savedSnapshot.value = snapshot()
}

function exportFile() {
  const blob = new Blob([exportProject({ name: project.name || 'Untitled', state: currentState() })], {
    type: 'application/json',
  })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = fileName(project.name)
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

function importFile(text) {
  if (!confirmDiscard()) return
  try {
    const p = importProject(text)
    applyState(p.state)
    project.id = null
    project.name = p.name
    savedName.value = ''
    savedSnapshot.value = ''
    say(`Imported "${p.name}". Save to keep it in this browser.`)
  } catch (e) {
    say(e.message)
  }
}

// Autosave the working state, so a reload or a closed tab loses nothing.
let autosaveTimer = null
watch(
  [snapshot, () => project.id, () => project.name],
  () => {
    clearTimeout(autosaveTimer)
    autosaveTimer = setTimeout(() => writeAutosave(storage, { projectId: project.id, name: project.name, state: currentState() }), 500)
  },
)

// The UIUC catalogue (~1,600 sections) loads after first paint.
const uiuc = shallowRef(null)
const catalogueError = ref(false)
onMounted(() => {
  loadCatalogue()
    .then((d) => (uiuc.value = d))
    .catch(() => (catalogueError.value = true))
})

// Selected panel, shared by the numeric panel editor and the plan editor.
const selectedPanel = ref(null)

// The expanded wing editor renders beside the calculator (see WingWorkspace), once mounted.
const rootEl = ref(null)
const workspaceTarget = ref(null)
const workspaceOpen = ref(false)
onMounted(() => {
  workspaceTarget.value = rootEl.value?.parentElement ?? null
})

// Undo/redo covers the wing shape, the plan's dimensions and the structure.
const history = useHistory(
  () => ({
    fuselageWidth: input.fuselageWidth,
    rootChord: input.rootChord,
    panels: input.panels,
    tip: input.tip,
    dimensions: input.dimensions,
    structure: input.structure,
  }),
  (v) => Object.assign(input, v),
)
// Ctrl+Z / Ctrl+Y (or Ctrl+Shift+Z) anywhere, except in a text field, which keeps its own undo
function onHistoryKey(e) {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.defaultPrevented) return
  if (e.target.closest?.('input, textarea, select, [contenteditable="true"]')) return
  const k = e.key.toLowerCase()
  if (k === 'z') e.shiftKey ? history.redo() : history.undo()
  else if (k === 'y') history.redo()
  else return
  e.preventDefault()
}
onMounted(() => window.addEventListener('keydown', onHistoryKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onHistoryKey))

const geometryModes = [
  { id: 'panels', label: 'Chords & panels' },
  { id: 'mean', label: 'Mean chord' },
  { id: 'area', label: 'Area' },
]

const geometry = computed(() => wingGeometry({ ...input, mode: input.geometryMode }))
const airfoil = computed(() => resolveAirfoil(airfoilSel.value, uiuc.value))
const baseThickness = computed(() => airfoil.value?.params?.thickness ?? null)

// The tip section, when the thickness tapers or the tip has washout (panel mode only).
const tipSection = computed(() => {
  const a = airfoil.value
  if (input.geometryMode !== 'panels' || !a?.valid || !(baseThickness.value > 0)) return null
  const tip = panelSections(input.panels, baseThickness.value).at(-1)?.outer
  if (!tip) return null
  const tapered = Math.abs(tip.thickness - baseThickness.value) > 1e-6
  if (!tapered && !tip.twist) return null
  const notes = []
  if (tapered) notes.push(`tip ${(tip.thickness * 100).toFixed(1)}% thick (dashed)`)
  if (tip.twist) notes.push(`${tip.twist.toFixed(2).replace(/\.?0+$/, '')}° washout at the tip`)
  return {
    coords: tapered ? scaleThickness(a.coords, tip.thickness / baseThickness.value) : null,
    note: notes.join(', ').replace(/^./, (c) => c.toUpperCase()) + '.',
  }
})

// Wing CLmax = 0.9 × cos(quarter-chord sweep) × section Clmax.
const sweepCos = computed(() => Math.cos(geometry.value.sweepQuarter ?? 0))
const sweepDeg = computed(() => ((geometry.value.sweepQuarter ?? 0) * 180) / Math.PI)

// The planform by projected span, for the lifting line (panel mode with a valid wing).
const planform = computed(() => {
  if (input.geometryMode !== 'panels' || !(geometry.value.area > 0) || geometry.value.invalid) return null
  return projectedSampler(wingSampler(input, baseThickness.value))
})

// XFOIL polars, computed in a worker and kept for the page's lifetime. Results show the
// instant answer (bundled polar or estimate) until the computed polar is ready.
const solver = usePolarSolver()
onBeforeUnmount(solver.dispose)
const polarKeyBase = computed(() =>
  airfoil.value?.valid ? `${coordsKey(airfoil.value.coords)}|${settingsKey(XFOIL_SETTINGS)}` : null,
)
const xfoil = computed(() => {
  const base = polarKeyBase.value
  if (!base) return { perf: null, need: null, status: null }
  const g = geometry.value
  // Stall speed uses projected area: dihedral tilts each panel's lift inwards.
  // In panel mode wing CLmax comes from the spanwise lift distribution, otherwise a fixed factor.
  const wing = {
    mass: input.mass,
    area: g.projectedArea,
    chord: g.mac,
    clMaxFactor: WING_CLMAX_FACTOR * sweepCos.value,
    wing: planform.value ? { planform: planform.value, span: g.span, sweepCos: sweepCos.value } : null,
  }
  return performanceWithXfoil(airfoil.value, wing, (re) => solver.lookup(`${base}@${re}`))
})
watch(
  () => [polarKeyBase.value, xfoil.value.need],
  ([base, need]) =>
    solver.want(
      base && need
        ? {
            key: `${base}@${need}`,
            coords: airfoil.value.coords.map(([x, y]) => [x, y]),
            re: need,
            settings: { ...XFOIL_SETTINGS },
          }
        : null,
    ),
  { immediate: true },
)

const results = computed(() => {
  const g = geometry.value
  const wl = wingLoading(input.mass, g.area)
  const wcl = cubeLoading(input.mass, g.area)
  return { wl, wcl, band: cubeBand(wcl), perf: xfoil.value.perf }
})

const warnings = computed(() =>
  validate({
    mass: input.mass,
    geometry: geometry.value,
    panels: input.geometryMode === 'panels' ? input.panels : null,
  }),
)
const warnFor = (field) => warnings.value.some((w) => w.field === field)
const warnFields = computed(() => warnings.value.map((w) => w.field))

// Marker position on the cube-loading scale (0..16+ oz/ft³ mapped to 0..100%).
const SCALE_MAX = 20
const bandScale = computed(() =>
  CUBE_BANDS.map((b) => ({
    ...b,
    left: (b.min / SCALE_MAX) * 100,
    width: ((Math.min(b.max, SCALE_MAX) - b.min) / SCALE_MAX) * 100,
  })),
)
const marker = computed(() => {
  const v = results.value.wcl
  if (v === null) return null
  const ozft3 = v / 1.001153
  return Math.min(100, (ozft3 / SCALE_MAX) * 100)
})

const rating = computed(() => {
  const s = results.value.perf?.stall
  return s ? { ...s, ...RATINGS[s.rating] } : null
})

// --- Structure ---------------------------------------------------------------------------

// Stage A loads and the parts to cut, for a panel wing whose stall the lifting line resolved.
const structureResult = computed(() => {
  const spanwise = results.value.perf?.spanwise
  if (!planform.value || !spanwise) return null
  const wing = { fuselageWidth: input.fuselageWidth, rootChord: input.rootChord, panels: input.panels, tip: input.tip }
  const a = analyseStructure({ wing, airfoil: airfoil.value, structure: input.structure, mass: input.mass, spanwise })
  if (!a) return null
  return { a, ...buildParts(a, a.structure, { handedness: input.exportOptions.handedness }) }
})
const structureOpen = ref(false)
const exportOpen = ref(false)
// Only one full-window editor at a time
watch(workspaceOpen, (v) => v && (structureOpen.value = false))
watch(structureOpen, (v) => {
  if (v) workspaceOpen.value = false
  else exportOpen.value = false
})
const selectedPart = ref(null)
// The plan or 3D card grown to fill most of the window, for now; one at a time
const expandedCard = ref(null)
const structureMainEl = ref(null)
const EXPAND_ICON = 'M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4'
const SHRINK_ICON = 'M6 2v4H2M14 6h-4V2M10 14v-4h4M2 10h4v4'
function toggleExpand(card) {
  expandedCard.value = expandedCard.value === card ? null : card
  // Bring the card's top into view once it has grown
  nextTick(() => structureMainEl.value?.querySelector(`[data-card="${card}"]`)?.scrollIntoView({ block: 'start' }))
}
const ribParts = computed(() => structureResult.value?.parts.filter((p) => p.group === 'ribs') ?? [])
const autoSpar = computed(() => sparFraction({ spar: { position: null } }, airfoil.value?.params))
// The ribs between the fixed ones, as distances from the root rib: where manual spacing starts
const ribDistances = computed(() => {
  const a = structureResult.value?.a
  return a ? a.ribs.filter((r) => r.kind === 'normal').map((r) => r.s - a.rootS) : []
})
const braceNeeds = computed(() => structureResult.value?.parts.filter((p) => p.group === 'braces').map((p) => p.need) ?? [])
const projectFileBase = computed(() => fileName(project.name).replace(/\.wingcalc\.json$/, ''))

const thin = (v) => format(v, 'thin', u('thin'))
const sparSummary = computed(() => {
  const sp = input.structure.spar
  const mat = (id) => MATERIALS[id]?.label.toLowerCase() ?? id
  if (sp.type === 'tube') return `${thin(sp.tubeDiameter)} ${mat(sp.tubeMaterial)}`
  if (sp.type === 'solid') return `${thin(sp.solidWidth)} × ${thin(sp.solidDepth)} ${mat(sp.solidMaterial)}`
  return `${sp.type === 'box' ? 'Box, ' : ''}${thin(sp.capWidth)} × ${thin(sp.capThickness)} ${mat(sp.capMaterial)} caps, ${thin(sp.webThickness)} web${sp.type === 'box' ? 's' : ''}`
})
const COVERING_LABELS = { open: 'Open, film covered', dbox: 'D-box', sheeted: 'Fully sheeted' }
const ribSummary = computed(() => {
  const r = structureResult.value?.a.ribs
  if (!r?.length) return '–'
  const bays = r.slice(1).map((x, i) => x.s - r[i].s)
  const lo = Math.min(...bays)
  const hi = Math.max(...bays)
  const lu = u('length')
  const spread = hi - lo < 0.002 ? format(hi, 'length', lu) : `${format(lo, 'length', lu)} to ${format(hi, 'length', lu)}`
  return `${r.length} per side, ${spread} apart`
})
const worstMargin = computed(() => {
  const w = structureResult.value?.a.summary.worst
  if (!w) return null
  return { ...w, label: MODES[w.mode] ?? w.mode, text: `${w.ms >= 0 ? '+' : ''}${w.ms.toFixed(2)}`, ok: w.ms >= 0 }
})
const structureWarnings = computed(() => {
  const r = structureResult.value
  if (!r) return []
  const out = [...r.a.warnings.map((w) => w.message)]
  for (const sk of r.skipped) {
    out.push(
      sk.reason === 'outside'
        ? `${sk.name} is too close to a panel end to run square to the spar, so it's left out.`
        : `${sk.name} is too short once the leading and trailing edge stock is taken off, so it's left out.`,
    )
  }
  const thinTe = r.parts.filter((p) => p.notes.some((n) => n.startsWith('Very thin')))
  if (thinTe.length) out.push(`${thinTe.map((p) => p.name).join(', ')}: very thin at the trailing edge cut. Use deeper TE stock or thinner skins.`)
  return out
})
watch(
  ribParts,
  (list) => {
    if (!list.length) return
    const all = structureResult.value.parts
    if (!all.some((p) => p.id === selectedPart.value)) selectedPart.value = list[0].id
  },
  { immediate: true },
)

// The wing geometry section's heading line when it's closed
const wingSummary = computed(() => {
  const g = geometry.value
  if (!g.span) return ''
  const n = input.geometryMode === 'panels' ? `${input.panels.length} panel${input.panels.length === 1 ? '' : 's'}, ` : ''
  return `${n}${format(g.span, 'length', u('length'))} span, ${format(g.area, 'area', u('area'))}`
})

const fmtRe = (re) => (re ? Math.round(re / 1000).toLocaleString('en-GB') + 'k' : '–')
</script>

<template>
  <div ref="rootEl" class="wingcalc" :data-theme="themeMode">
    <header class="wc-header">
      <div class="wc-header__title">
        <h2 class="wc-title">Wing loading calculator</h2>
        <p class="wc-subtitle">RC fixed-wing aircraft, 600 mm to 3 m span</p>
      </div>
      <ProjectBar
        v-model:name="project.name"
        :projects="projects"
        :current-id="project.id"
        :dirty="dirty"
        :storage-ok="!!storage"
        :status="status"
        @save="save()"
        @save-copy="save({ copy: true })"
        @open="open"
        @delete="remove"
        @new="newProject"
        @export="exportFile"
        @import="importFile"
      />
      <UndoRedo :can-undo="history.canUndo.value" :can-redo="history.canRedo.value" @undo="history.undo" @redo="history.redo" />
      <div class="wc-header__prefs">
        <div class="wc-toggle" role="radiogroup" aria-label="Unit system">
          <button
            v-for="(s, key) in SYSTEMS"
            :key="key"
            type="button"
            role="radio"
            :aria-checked="system === key"
            class="wc-toggle__btn"
            :class="{ 'wc-toggle__btn--active': system === key }"
            @click="system = key"
          >
            {{ s.label }}
          </button>
        </div>
        <div class="wc-toggle" role="radiogroup" aria-label="Colour theme">
          <button
            v-for="t in THEMES"
            :key="t.id"
            type="button"
            role="radio"
            :aria-checked="themeMode === t.id"
            class="wc-toggle__btn"
            :class="{ 'wc-toggle__btn--active': themeMode === t.id }"
            :title="t.title"
            @click="themeMode = t.id"
          >
            {{ t.label }}
          </button>
        </div>
      </div>
    </header>

    <div class="wc-layout">
      <!-- Inputs -->
      <section class="wc-panel wc-inputs wc-inspector" aria-label="Inputs">
        <InspectorSection title="Aircraft" fold-key="page:aircraft" :summary="format(input.mass, 'mass', u('mass'))" open>
        <UnitInput
          id="wc-mass"
          v-model="input.mass"
          quantity="mass"
          :system="system"
          label="All-up weight"
          :warn="warnFor('mass')"
        />
        </InspectorSection>

        <InspectorSection title="Wing geometry" fold-key="page:wing" :summary="wingSummary" open>
        <div class="wc-segmented wc-segmented--small" role="radiogroup" aria-label="Wing size from">
          <button
            v-for="m in geometryModes"
            :key="m.id"
            type="button"
            role="radio"
            :aria-checked="input.geometryMode === m.id"
            class="wc-segmented__btn"
            :class="{ 'wc-segmented__btn--active': input.geometryMode === m.id }"
            @click="input.geometryMode = m.id"
          >
            {{ m.label }}
          </button>
        </div>
        <PanelEditor
          v-if="input.geometryMode === 'panels'"
          v-model:fuselage-width="input.fuselageWidth"
          v-model:root-chord="input.rootChord"
          v-model:panels="input.panels"
          v-model:tip="input.tip"
          v-model:selected="selectedPanel"
          :system="system"
          :warn-fields="warnFields"
          :base-thickness="baseThickness"
        />
        <UnitInput
          v-else
          id="wc-span"
          v-model="input.span"
          quantity="length"
          :system="system"
          label="Wingspan"
          :warn="warnFor('span')"
        />
        <UnitInput
          v-if="input.geometryMode === 'mean'"
          id="wc-mean"
          v-model="input.meanChord"
          quantity="length"
          :system="system"
          label="Mean chord"
        />
        <UnitInput
          v-else-if="input.geometryMode === 'area'"
          id="wc-area"
          v-model="input.area"
          quantity="area"
          :system="system"
          label="Wing area"
          :warn="warnFor('area')"
          hint="Include the area of the wing passing through the fuselage, as is usual."
        />
        <p v-if="input.geometryMode === 'panels' && geometry.span" class="wc-derived">
          Wingspan {{ format(geometry.span, 'length', u('length')) }}
          <span class="wc-muted">({{ format(geometry.span, 'length', u('length', alt)) }})</span>
          <template v-if="geometry.hasDihedral">
            <br />Flat span {{ format(geometry.flatSpan, 'length', u('length')) }}
          </template>
        </p>
        <p v-if="input.geometryMode !== 'area' && geometry.area" class="wc-derived">
          Wing area {{ format(geometry.area, 'area', u('area')) }}
          <span class="wc-muted">({{ format(geometry.area, 'area', u('area', alt)) }})</span>
        </p>
        </InspectorSection>

        <InspectorSection title="Aerofoil" fold-key="page:aerofoil" :summary="airfoil?.name ?? ''" open>
        <AirfoilPicker v-model="airfoilSel" :uiuc="uiuc" />
        <p v-if="catalogueError" class="wc-field__hint wc-text-warn">
          The full aerofoil catalogue couldn't be loaded; only sections with polar data are listed.
        </p>
        </InspectorSection>

        <ul v-if="warnings.length" class="wc-warnings">
          <li v-for="w in warnings" :key="w.field">{{ w.message }}</li>
        </ul>
      </section>

      <!-- Results -->
      <section class="wc-results" aria-label="Results" aria-live="polite">
        <div class="wc-headline">
          <article class="wc-card wc-card--verdict" :data-band="results.band?.id">
            <h3 class="wc-card__label">Wing cube loading</h3>
            <p class="wc-card__value">
              {{ format(results.wcl, 'cubeLoading', u('cubeLoading')) }}
              <span class="wc-card__alt">{{ format(results.wcl, 'cubeLoading', u('cubeLoading', alt)) }}</span>
            </p>
            <p class="wc-card__verdict">{{ results.band?.label ?? 'Enter weight and wing size' }}</p>
            <p v-if="results.band" class="wc-card__note">{{ results.band.note }}</p>
            <div class="wc-scale" aria-hidden="true">
              <div
                v-for="b in bandScale"
                :key="b.id"
                class="wc-scale__band"
                :class="{ 'wc-scale__band--active': results.band?.id === b.id }"
                :style="{ left: b.left + '%', width: b.width + '%' }"
              />
              <div v-if="marker !== null" class="wc-scale__marker" :style="{ left: marker + '%' }" />
            </div>
          </article>

          <article class="wc-card">
            <h3 class="wc-card__label">Stall speed</h3>
            <p class="wc-card__value">
              {{ format(results.perf?.stallSpeed, 'speed', u('speed')) }}
            </p>
            <p class="wc-card__alt-list">
              <span v-for="unit in ['ms', 'kmh', 'mph'].filter((x) => x !== u('speed'))" :key="unit">
                {{ format(results.perf?.stallSpeed, 'speed', unit) }}
              </span>
            </p>
            <p v-if="results.perf" class="wc-card__note">
              Level flight, sea level (ρ = {{ RHO_SEA_LEVEL }} kg/m³)<template v-if="geometry.hasDihedral"
                >, projected wing area</template
              >.
              <template v-if="results.perf.method === 'lifting-line'">
                Wing CLmax {{ results.perf.wingClMax.toFixed(2) }} from the spanwise lift distribution<template
                  v-if="Math.abs(sweepDeg) >= 3"
                >
                  × cos {{ Math.abs(sweepDeg).toFixed(1) }}° sweep</template
                >, {{ (results.perf.clMaxFactor * 100).toFixed(0) }}% of root section Clmax
                {{ results.perf.sectionClMax.toFixed(2) }}
              </template>
              <template v-else>
                Wing CLmax {{ results.perf.wingClMax.toFixed(2) }} = {{ WING_CLMAX_FACTOR }}
                <template v-if="Math.abs(sweepDeg) >= 3">× cos {{ Math.abs(sweepDeg).toFixed(1) }}° sweep </template>×
                section Clmax {{ results.perf.sectionClMax.toFixed(2) }}
              </template>
              <template v-if="results.perf.clMaxSource === 'xfoil'"
                >from XFOIL at Re {{ fmtRe(results.perf.polar.re) }}, computed here</template
              >
              <template v-else-if="results.perf.clMaxSource === 'polar'"
                >at Re {{ fmtRe(results.perf.reynolds) }} (airfoiltools.com polars)</template
              >
              <template v-else>(estimated from camber and thickness at Re {{ fmtRe(results.perf.reynolds) }})</template>.
              <template v-if="xfoil.status === 'computing'"> Computing an XFOIL polar…</template>
              <template v-else-if="xfoil.status === 'failed'">
                XFOIL couldn't produce a usable polar for this section, so this is
                {{ results.perf.clMaxSource === 'polar' ? 'from the bundled data' : 'the estimate' }}.</template
              >
            </p>
            <p v-if="results.perf?.reference?.differs" class="wc-notice-warn">
              XFOIL here gives a section Clmax of {{ results.perf.sectionClMax.toFixed(2) }} at Re
              {{ fmtRe(results.perf.polar.re) }}; the airfoiltools.com polars give
              {{ results.perf.reference.clMax.toFixed(2) }}. The results use the value computed here.
            </p>
          </article>
        </div>

        <dl class="wc-stats">
          <div>
            <dt>Wing loading</dt>
            <dd>
              {{ format(results.wl, 'wingLoading', u('wingLoading')) }}
              <span class="wc-muted">{{ format(results.wl, 'wingLoading', u('wingLoading', alt)) }}</span>
            </dd>
          </div>
          <div>
            <dt>Wing area<template v-if="geometry.hasDihedral"> (flat)</template></dt>
            <dd>
              {{ format(geometry.area, 'area', u('area')) }}
              <span class="wc-muted">{{ format(geometry.area, 'area', u('area', alt)) }}</span>
            </dd>
          </div>
          <div v-if="geometry.fuselageHalf > 0">
            <dt>Exposed area (outside fuselage)</dt>
            <dd>
              {{ format(geometry.exposedArea, 'area', u('area')) }}
              <span class="wc-muted">{{ format(geometry.exposedArea, 'area', u('area', alt)) }}</span>
            </dd>
          </div>
          <div v-if="geometry.hasDihedral">
            <dt>Projected area (from above)</dt>
            <dd>
              {{ format(geometry.projectedArea, 'area', u('area')) }}
              <span class="wc-muted">{{ format(geometry.projectedArea, 'area', u('area', alt)) }}</span>
            </dd>
          </div>
          <div>
            <dt>All-up weight</dt>
            <dd>
              {{ format(input.mass, 'mass', u('mass')) }}
              <span class="wc-muted">{{ format(input.mass, 'mass', u('mass', alt)) }}</span>
            </dd>
          </div>
          <div>
            <dt>Mean aerodynamic chord</dt>
            <dd>
              {{ format(geometry.mac, 'length', u('length')) }}
              <span class="wc-muted">{{ format(geometry.mac, 'length', u('length', alt)) }}</span>
            </dd>
          </div>
          <div v-if="Math.abs(sweepDeg) >= 3">
            <dt>Quarter-chord sweep</dt>
            <dd>{{ sweepDeg.toFixed(1) }}°</dd>
          </div>
          <div>
            <dt>Aspect ratio</dt>
            <dd>{{ geometry.aspectRatio ? geometry.aspectRatio.toFixed(1) : '–' }}</dd>
          </div>
          <div>
            <dt>Reynolds number at stall</dt>
            <dd>{{ fmtRe(results.perf?.reynolds) }}</dd>
          </div>
        </dl>

        <details class="wc-bands">
          <summary>Cube-loading bands</summary>
          <table class="wc-table">
            <thead>
              <tr>
                <th scope="col">Band</th>
                <th scope="col">oz/ft³ (≈ g/dm³)</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="b in CUBE_BANDS" :key="b.id" :class="{ 'wc-table__row--active': results.band?.id === b.id }">
                <td>{{ b.label }}</td>
                <td>{{ b.max === Infinity ? `${b.min} and above` : `${b.min} to ${b.max}` }}</td>
              </tr>
            </tbody>
          </table>
          <p class="wc-muted">
            Cube loading is weight ÷ area<sup>1.5</sup>. Unlike wing loading it doesn't grow with model size, so the same
            band means a similar feel in the air whatever the span. 1 oz/ft³ = 1.001 g/dm³.
          </p>
        </details>

        <article v-if="input.geometryMode === 'panels'" class="wc-card wc-plan-card">
          <div class="wc-plan-card__head">
            <h3 class="wc-card__label">Wing plan (one side, flat as built)</h3>
            <button type="button" class="wc-button" @click="workspaceOpen = true">Open wing editor</button>
          </div>
          <p v-if="workspaceOpen" class="wc-muted">Editing in the wing editor.</p>
          <WingPlanEditor
            v-else
            v-model:fuselage-width="input.fuselageWidth"
            v-model:root-chord="input.rootChord"
            v-model:panels="input.panels"
            v-model:tip="input.tip"
            v-model:dimensions="input.dimensions"
            v-model:selected="selectedPanel"
            :system="system"
            @commit="history.commit"
          />
        </article>

        <article v-if="input.geometryMode === 'panels'" class="wc-card wc-structure-card">
          <div class="wc-plan-card__head">
            <h3 class="wc-card__label">Structure and ribs</h3>
            <button type="button" class="wc-button" :disabled="!structureResult" @click="structureOpen = true">
              Open structure editor
            </button>
          </div>
          <template v-if="structureResult">
            <dl class="wc-stats wc-structure-card__stats">
              <div>
                <dt>Spar</dt>
                <dd>{{ sparSummary }}</dd>
              </div>
              <div>
                <dt>Covering</dt>
                <dd>{{ COVERING_LABELS[input.structure.covering.type] }}</dd>
              </div>
              <div>
                <dt>Ribs</dt>
                <dd>{{ ribSummary }}</dd>
              </div>
              <div v-if="worstMargin">
                <dt>Lowest margin at {{ input.structure.loads.designG }} g</dt>
                <dd :class="worstMargin.ok ? 'wc-text-ok' : 'wc-text-bad'">
                  {{ worstMargin.text }} <span class="wc-muted">{{ worstMargin.label.toLowerCase() }}, {{ format(worstMargin.d, 'length', u('length')) }} out</span>
                </dd>
              </div>
              <div>
                <dt>Root bending moment</dt>
                <dd>{{ structureResult.a.rootMoment.toFixed(1) }} N·m</dd>
              </div>
              <div>
                <dt>Structure weight (estimate)</dt>
                <dd>
                  {{ format(structureResult.weight.total, 'mass', u('mass')) }}
                  <span class="wc-muted">{{ Math.round((structureResult.weight.total / input.mass) * 100) }}% of all-up weight</span>
                </dd>
              </div>
            </dl>
            <ul v-if="structureWarnings.length" class="wc-warnings">
              <li v-for="(w, i) in structureWarnings" :key="i">{{ w }}</li>
            </ul>
            <p class="wc-disclaimer">
              A first-order sizing check (Stage A): bending and shear at the design load, not torsion, flutter or joints.
              Wood varies; treat margins under +0.3 with suspicion.
            </p>
          </template>
          <p v-else class="wc-muted">Needs a valid wing and aerofoil to work out the loads.</p>
        </article>

        <div class="wc-lower">
          <article v-if="rating" class="wc-card wc-stall" :data-rating="rating.rating">
            <div class="wc-stall__head">
              <h3 class="wc-card__label">Stall character</h3>
              <span class="wc-pill" :data-rating="rating.rating">{{ rating.label }}</span>
            </div>
            <p class="wc-stall__summary">{{ rating.summary }}</p>
            <p class="wc-card__note">
              {{ rating.explanation }}
              <template v-if="rating.method === 'geometry'">
                Estimated from section shape<template v-if="xfoil.status === 'computing'"> until the XFOIL polar is ready</template
                ><template v-else>, as there's no usable polar for this section</template>.</template
              >
              <template v-else-if="rating.confidence === 'low'"> Limited post-stall data, so treat with extra caution.</template>
            </p>
            <p v-if="rating.spanwise" class="wc-card__note">
              {{ rating.spanwise.text }}
              <template v-if="rating.spanwise.sharper && rating.sectionRating !== rating.rating">
                The section alone rates {{ RATINGS[rating.sectionRating].label.toLowerCase() }}.</template
              >
            </p>
            <SpanLiftChart
              v-if="results.perf?.spanwise"
              :distribution="results.perf.spanwise.distribution"
              :onset-eta="results.perf.spanwise.onsetEta"
            />
            <LiftCurve v-if="results.perf?.curve" :curve="results.perf.curve" />
            <p class="wc-disclaimer">Indicative only: not a substitute for flight testing.</p>
          </article>

          <div class="wc-drawings">
            <SectionView
              v-if="airfoil"
              :coords="airfoil.coords"
              :params="airfoil.params"
              :name="airfoil.name"
              :valid="airfoil.valid"
              :tip-coords="tipSection?.coords ?? null"
              :tip-note="tipSection?.note ?? ''"
            />
            <PlanformView
              v-if="input.geometryMode !== 'panels' || geometry.hasDihedral"
              :geometry="geometry"
              :length-unit="u('length')"
              :show-top="input.geometryMode !== 'panels'"
            />
          </div>
        </div>

        <p v-if="airfoil?.kind === 'catalogue'" class="wc-source">
          Section data: <a :href="airfoil.source" target="_blank" rel="noopener">UIUC Airfoil Coordinates Database</a>
          ({{ airfoil.description }}). <template v-if="results.perf?.clMaxSource === 'xfoil'"
            >Clmax, stall rating and lift curve computed here with XFOIL.</template
          ><template v-else>Coordinates only: Clmax is estimated and the lift curve is indicative.</template>
        </p>
        <p v-if="airfoil?.kind === 'library'" class="wc-source">
          Section data:
          <a :href="airfoil.section.source" target="_blank" rel="noopener">airfoiltools.com</a>
          (coordinates from the UIUC Airfoil Coordinates Database; XFOIL polars, Ncrit 9)<template
            v-if="results.perf?.clMaxSource === 'xfoil'"
            >. Clmax, stall rating and lift curve are computed here with XFOIL at Re
            {{ results.perf.polar.re.toLocaleString('en-GB') }}; the airfoiltools.com polars are shown until that's
            ready.</template
          ><template v-else-if="results.perf?.polar"
            >. Re {{ results.perf.polar.re.toLocaleString('en-GB') }} used for the stall rating.</template
          ><template v-else>.</template>
        </p>
      </section>
    </div>

    <Teleport v-if="workspaceTarget && structureResult" :to="workspaceTarget">
      <WingWorkspace v-model:open="structureOpen" :theme="themeMode" title="Structure and ribs">
        <template #stats>
          <span class="wc-stat"><span>Ribs</span>{{ structureResult.a.ribs.length }} per side</span>
          <span v-if="worstMargin" class="wc-stat" :class="worstMargin.ok ? 'wc-text-ok' : 'wc-text-bad'">
            <span>Lowest margin</span>{{ worstMargin.text }} <em>{{ worstMargin.label.toLowerCase() }}</em>
          </span>
          <span class="wc-stat"><span>Root bending</span>{{ structureResult.a.rootMoment.toFixed(1) }} N·m</span>
          <span class="wc-stat"><span>Structure</span>{{ format(structureResult.weight.total, 'mass', u('mass')) }}</span>
          <button type="button" class="wc-button" @click="exportOpen = true">Export…</button>
        </template>
        <template #actions>
          <UndoRedo :can-undo="history.canUndo.value" :can-redo="history.canRedo.value" @undo="history.undo" @redo="history.redo" />
        </template>
        <template #side>
          <StructureEditor
            v-model:structure="input.structure"
            :system="system"
            :auto-spar="autoSpar"
            :brace-needs="braceNeeds"
            :rib-distances="ribDistances"
            :edges="structureResult?.a.edges"
          />
          <ul v-if="structureWarnings.length" class="wc-warnings">
            <li v-for="(w, i) in structureWarnings" :key="i">{{ w }}</li>
          </ul>
        </template>
        <template #main>
          <ExportPanel
            v-if="exportOpen"
            v-model:options="input.exportOptions"
            v-model:structure="input.structure"
            :analysis="structureResult.a"
            :parts="structureResult.parts"
            :cut-list="structureResult.cutList"
            :system="system"
            :base-name="projectFileBase"
            :project-name="project.name || 'Untitled'"
            @close="exportOpen = false"
          />
          <div ref="structureMainEl" class="wc-structure-main">
            <article class="wc-card wc-structure-main__wide" :class="{ 'wc-card--expanded': expandedCard === 'plan' }" data-card="plan">
              <div class="wc-card__head">
                <h3 class="wc-card__label">Plan</h3>
                <button
                  type="button"
                  class="wc-iconbtn wc-expand"
                  :aria-pressed="expandedCard === 'plan'"
                  :aria-label="expandedCard === 'plan' ? 'Shrink the plan' : 'Expand the plan'"
                  :title="expandedCard === 'plan' ? 'Shrink back' : 'Expand to fill the window'"
                  @click="toggleExpand('plan')"
                >
                  <svg viewBox="0 0 16 16" aria-hidden="true"><path :d="expandedCard === 'plan' ? SHRINK_ICON : EXPAND_ICON" /></svg>
                </button>
              </div>
              <StructurePlan
                v-model:structure="input.structure"
                :analysis="structureResult.a"
                :parts="structureResult.parts"
                :selected="selectedPart"
                :system="system"
                :editable="input.structure.ribs.spacing === 'manual'"
                @select="selectedPart = $event"
                @commit="history.commit"
              />
            </article>
            <article class="wc-card wc-structure-main__wide" :class="{ 'wc-card--expanded': expandedCard === '3d' }" data-card="3d">
              <div class="wc-card__head">
                <h3 class="wc-card__label">3D</h3>
                <button
                  type="button"
                  class="wc-iconbtn wc-expand"
                  :aria-pressed="expandedCard === '3d'"
                  :aria-label="expandedCard === '3d' ? 'Shrink the 3D view' : 'Expand the 3D view'"
                  :title="expandedCard === '3d' ? 'Shrink back' : 'Expand to fill the window'"
                  @click="toggleExpand('3d')"
                >
                  <svg viewBox="0 0 16 16" aria-hidden="true"><path :d="expandedCard === '3d' ? SHRINK_ICON : EXPAND_ICON" /></svg>
                </button>
              </div>
              <Structure3D
                :analysis="structureResult.a"
                :structure="structureResult.a.structure"
                :parts="structureResult.parts"
                :system="system"
                :selected="selectedPart"
                @select="selectedPart = $event"
              />
            </article>
            <article class="wc-card">
              <h3 class="wc-card__label">Loads</h3>
              <LoadsChart :analysis="structureResult.a" :ribs="ribParts" :system="system" :design-g="input.structure.loads.designG" />
            </article>
            <article class="wc-card">
              <h3 class="wc-card__label">Part</h3>
              <PartPreview :parts="structureResult.parts" :selected="selectedPart" :system="system" @select="selectedPart = $event" />
            </article>
          </div>
        </template>
      </WingWorkspace>
    </Teleport>

    <Teleport v-if="workspaceTarget" :to="workspaceTarget">
      <WingWorkspace v-model:open="workspaceOpen" :theme="themeMode">
        <template #stats>
          <span class="wc-stat"><span>Span</span>{{ format(geometry.span, 'length', u('length')) }}</span>
          <span class="wc-stat"><span>Area</span>{{ format(geometry.area, 'area', u('area')) }}</span>
          <span class="wc-stat"><span>Aspect ratio</span>{{ geometry.aspectRatio ? geometry.aspectRatio.toFixed(1) : '–' }}</span>
          <span class="wc-stat" :data-band="results.band?.id">
            <span>Cube loading</span>{{ format(results.wcl, 'cubeLoading', u('cubeLoading')) }}
            <em v-if="results.band">{{ results.band.label }}</em>
          </span>
          <span class="wc-stat"><span>Stall speed</span>{{ format(results.perf?.stallSpeed, 'speed', u('speed')) }}</span>
        </template>
        <template #actions>
          <UndoRedo :can-undo="history.canUndo.value" :can-redo="history.canRedo.value" @undo="history.undo" @redo="history.redo" />
        </template>
        <template #side>
          <PanelEditor
            v-model:fuselage-width="input.fuselageWidth"
            v-model:root-chord="input.rootChord"
            v-model:panels="input.panels"
            v-model:tip="input.tip"
            v-model:selected="selectedPanel"
            :system="system"
            :warn-fields="warnFields"
            :base-thickness="baseThickness"
            id-prefix="wcx"
          />
          <ul v-if="warnings.length" class="wc-warnings">
            <li v-for="w in warnings" :key="w.field">{{ w.message }}</li>
          </ul>
        </template>
        <template #main>
          <WingPlanEditor
            v-model:fuselage-width="input.fuselageWidth"
            v-model:root-chord="input.rootChord"
            v-model:panels="input.panels"
            v-model:tip="input.tip"
            v-model:dimensions="input.dimensions"
            v-model:selected="selectedPanel"
            :system="system"
            fill
            @commit="history.commit"
          />
          <PlanformView
            v-if="geometry.hasDihedral"
            class="wc-workspace__front"
            :geometry="geometry"
            :length-unit="u('length')"
            :show-top="false"
          />
        </template>
      </WingWorkspace>
    </Teleport>
  </div>
</template>