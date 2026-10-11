<script setup>
import { ref, reactive, computed, shallowRef, onMounted, onBeforeUnmount, watch } from 'vue'
import UnitInput from './components/UnitInput.vue'
import AirfoilPicker from './components/AirfoilPicker.vue'
import SectionView from './components/SectionView.vue'
import PlanformView from './components/PlanformView.vue'
import PanelEditor from './components/PanelEditor.vue'
import WingPlanEditor from './components/WingPlanEditor.vue'
import ProjectBar from './components/ProjectBar.vue'
import WingWorkspace from './components/WingWorkspace.vue'
import { useHistory } from './composables/useHistory.js'
import { usePolarSolver } from './composables/usePolarSolver.js'
import LiftCurve from './components/LiftCurve.vue'
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

// Undo/redo covers the wing shape and the plan's dimensions.
const history = useHistory(
  () => ({
    fuselageWidth: input.fuselageWidth,
    rootChord: input.rootChord,
    panels: input.panels,
    tip: input.tip,
    dimensions: input.dimensions,
  }),
  (v) => Object.assign(input, v),
)

const geometryModes = [
  { id: 'panels', label: 'Chords & panels' },
  { id: 'mean', label: 'Mean chord' },
  { id: 'area', label: 'Area' },
]

const geometry = computed(() => wingGeometry({ ...input, mode: input.geometryMode }))
const airfoil = computed(() => resolveAirfoil(airfoilSel.value, uiuc.value))

// Wing CLmax = 0.9 × cos(quarter-chord sweep) × section Clmax.
const sweepCos = computed(() => Math.cos(geometry.value.sweepQuarter ?? 0))
const sweepDeg = computed(() => ((geometry.value.sweepQuarter ?? 0) * 180) / Math.PI)

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
  const wing = { mass: input.mass, area: g.projectedArea, chord: g.mac, clMaxFactor: WING_CLMAX_FACTOR * sweepCos.value }
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
      <section class="wc-panel wc-inputs" aria-label="Inputs">
        <h3 class="wc-panel__title">Aircraft</h3>
        <UnitInput
          id="wc-mass"
          v-model="input.mass"
          quantity="mass"
          :system="system"
          label="All-up weight"
          :warn="warnFor('mass')"
        />

        <h3 class="wc-panel__title">Wing geometry</h3>
        <div class="wc-segmented" role="radiogroup" aria-label="Wing size from">
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

        <h3 class="wc-panel__title">Aerofoil</h3>
        <AirfoilPicker v-model="airfoilSel" :uiuc="uiuc" />
        <p v-if="catalogueError" class="wc-field__hint wc-text-warn">
          The full aerofoil catalogue couldn't be loaded; only sections with polar data are listed.
        </p>

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
              >. Wing CLmax {{ results.perf.wingClMax.toFixed(2) }} = {{ WING_CLMAX_FACTOR }}
              <template v-if="Math.abs(sweepDeg) >= 3">× cos {{ Math.abs(sweepDeg).toFixed(1) }}° sweep </template>×
              section Clmax {{ results.perf.sectionClMax.toFixed(2) }}
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
            :can-undo="history.canUndo.value"
            :can-redo="history.canRedo.value"
            @undo="history.undo"
            @redo="history.redo"
            @commit="history.commit"
          />
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
        <template #side>
          <PanelEditor
            v-model:fuselage-width="input.fuselageWidth"
            v-model:root-chord="input.rootChord"
            v-model:panels="input.panels"
            v-model:tip="input.tip"
            v-model:selected="selectedPanel"
            :system="system"
            :warn-fields="warnFields"
            focused
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
            :can-undo="history.canUndo.value"
            :can-redo="history.canRedo.value"
            fill
            @undo="history.undo"
            @redo="history.redo"
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