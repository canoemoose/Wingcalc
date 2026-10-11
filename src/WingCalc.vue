<script setup>
import { ref, reactive, computed, shallowRef, onMounted } from 'vue'
import UnitInput from './components/UnitInput.vue'
import AirfoilPicker from './components/AirfoilPicker.vue'
import SectionView from './components/SectionView.vue'
import PlanformView from './components/PlanformView.vue'
import PanelEditor from './components/PanelEditor.vue'
import WingPlanEditor from './components/WingPlanEditor.vue'
import { useHistory } from './composables/useHistory.js'
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
import { resolveAirfoil, airfoilPerformance, sectionsIn, loadCatalogue, estimateClMax } from './lib/airfoils.js'
import { normalisePanels } from './lib/wing.js'
import { RATINGS } from './lib/stall.js'

const props = defineProps({
  units: { type: String, default: 'metric' },
  theme: { type: String, default: 'auto' }, // 'auto' follows the OS; 'light' forces light
})

const system = ref(SYSTEMS[props.units] ? props.units : 'metric')
const alt = computed(() => otherSystem(system.value))
const u = (q, s = system.value) => defaultUnit(s, q)

// All values in SI base units. Defaults describe a typical 1.4 m sport model.
const input = reactive({
  mass: 1.4,
  span: 1.4,
  geometryMode: 'panels',
  fuselageWidth: 0,
  rootChord: 0.25,
  panels: normalisePanels([{ length: 0.7, tipChord: 0.18, dihedral: 0 }]),
  meanChord: 0.215,
  area: 0.301,
})

const firstNaca = sectionsIn('naca').find((s) => s.id === 'naca2412-il') ?? sectionsIn('naca')[0]
const airfoilSel = ref({
  source: 'naca',
  id: firstNaca?.id ?? null,
  lastLibraryId: firstNaca?.id ?? null,
  clMaxOverride: null,
  custom: { clMax: 1.25, thicknessPct: 12, thicknessPosPct: 30, camberPct: 2, camberPosPct: 40, leRadiusPct: 1.59 },
})

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

// Undo/redo covers the wing shape.
const history = useHistory(
  () => ({ fuselageWidth: input.fuselageWidth, rootChord: input.rootChord, panels: input.panels }),
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

const results = computed(() => {
  const g = geometry.value
  const wl = wingLoading(input.mass, g.area)
  const wcl = cubeLoading(input.mass, g.area)
  const perf = airfoil.value?.valid
    ? // Stall speed uses projected area: dihedral tilts each panel's lift inwards.
      airfoilPerformance(airfoil.value, {
        mass: input.mass,
        area: g.projectedArea,
        chord: g.mac,
        clMaxFactor: WING_CLMAX_FACTOR * sweepCos.value,
      })
    : null
  return { wl, wcl, band: cubeBand(wcl), perf }
})

const warnings = computed(() =>
  validate({
    mass: input.mass,
    geometry: geometry.value,
    panels: input.geometryMode === 'panels' ? input.panels : null,
  }),
)
// Shown as the placeholder for the Clmax override on sections without polars.
const estimatedClMax = computed(() => {
  const a = airfoil.value
  if (a?.kind !== 'catalogue') return null
  return estimateClMax(
    { camberPct: a.params.camber * 100, thicknessPct: a.params.thickness * 100 },
    results.value.perf?.reynolds ?? 200000,
  )
})

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
  <div class="wingcalc" :data-theme="theme">
    <header class="wc-header">
      <div>
        <h2 class="wc-title">Wing loading calculator</h2>
        <p class="wc-subtitle">RC fixed-wing aircraft, 600 mm to 3 m span</p>
      </div>
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
        <AirfoilPicker v-model="airfoilSel" :uiuc="uiuc" :estimated-cl-max="estimatedClMax" />
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
              <template v-if="results.perf.clMaxSource === 'polar'">at Re {{ fmtRe(results.perf.reynolds) }}</template>
              <template v-else-if="results.perf.clMaxSource === 'estimated'"
                >(estimated from camber and thickness at Re {{ fmtRe(results.perf.reynolds) }})</template
              >
              <template v-else>(entered)</template>.
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

        <article v-if="rating" class="wc-card wc-stall" :data-rating="rating.rating">
          <div class="wc-stall__head">
            <h3 class="wc-card__label">Stall character</h3>
            <span class="wc-pill" :data-rating="rating.rating">{{ rating.label }}</span>
          </div>
          <p class="wc-stall__summary">{{ rating.summary }}</p>
          <p class="wc-card__note">
            {{ rating.explanation }}
            <template v-if="rating.method === 'geometry'">
              Estimated from section shape, as there's no polar data for this section.</template
            >
            <template v-else-if="rating.confidence === 'low'"> Limited post-stall data, so treat with extra caution.</template>
          </p>
          <LiftCurve v-if="results.perf?.curve" :curve="results.perf.curve" />
          <p class="wc-disclaimer">Indicative only: not a substitute for flight testing.</p>
        </article>

        <article v-if="input.geometryMode === 'panels'" class="wc-card wc-plan-card">
          <h3 class="wc-card__label">Wing plan (one side, flat as built)</h3>
          <WingPlanEditor
            v-model:fuselage-width="input.fuselageWidth"
            v-model:root-chord="input.rootChord"
            v-model:panels="input.panels"
            v-model:selected="selectedPanel"
            :system="system"
            :can-undo="history.canUndo.value"
            :can-redo="history.canRedo.value"
            @undo="history.undo"
            @redo="history.redo"
            @commit="history.commit"
          />
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

        <p v-if="airfoil?.kind === 'catalogue'" class="wc-source">
          Section data: <a :href="airfoil.source" target="_blank" rel="noopener">UIUC Airfoil Coordinates Database</a>
          ({{ airfoil.description }}). Coordinates only: Clmax is
          {{ airfoil.clMaxOverride !== null ? 'as entered' : 'estimated' }} and the lift curve is indicative.
        </p>
        <p v-if="airfoil?.kind === 'library'" class="wc-source">
          Section data:
          <a :href="airfoil.section.source" target="_blank" rel="noopener">airfoiltools.com</a>
          (coordinates from the UIUC Airfoil Coordinates Database; XFOIL polars, Ncrit 9<template
            v-if="results.perf?.polar"
            >, Re {{ results.perf.polar.re.toLocaleString('en-GB') }} used for the stall rating</template
          >).
        </p>
      </section>
    </div>
  </div>
</template>
