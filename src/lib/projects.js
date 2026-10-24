// Saving and opening projects. Projects live in localStorage (one key holding them all) and
// the working state autosaves to a second key. Storage is passed in, so this is testable and
// so a missing or blocked localStorage just means nothing is saved: every access is guarded.

import { normalisePanels } from './wing.js'
import { defaultStructure } from './structure.js'
import { defaultExportOptions } from './dxf.js'
import { normaliseUnits } from './units.js'
import { defaultControls } from './controlSurfaces.js'
import { isDrawnSection } from './sectionSpline.js'

export const FORMAT_VERSION = 1
const PROJECTS_KEY = 'wingcalc.projects.v1'
const AUTOSAVE_KEY = 'wingcalc.autosave.v1'
const FILE_APP = 'wingcalc'

// The state of a new project, in SI base units. A typical 1.4 m sport model.
export function defaultState() {
  return {
    units: normaliseUnits('metric'), // { system, length, mass, speed }; see units.js
    input: {
      mass: 1.4,
      span: 1.4,
      geometryMode: 'panels',
      fuselageWidth: 0,
      rootChord: 0.25,
      panels: normalisePanels([{ length: 0.7, tipChord: 0.18, dihedral: 0 }]),
      tip: null,
      dimensions: [],
      controls: defaultControls(), // control surfaces and crow (controlSurfaces.js)
      meanChord: 0.215,
      area: 0.301,
      structure: defaultStructure(),
      exportOptions: defaultExportOptions(),
    },
    airfoil: {
      source: 'naca',
      id: 'naca2412-il',
      lastLibraryId: 'naca2412-il',
      // drawn: a section drawn in the section editor, { pts, seed }, or null to use the parametric values above
      custom: { thicknessPct: 12, thicknessPosPct: 30, camberPct: 2, camberPosPct: 40, leRadiusPct: 1.59, drawn: null },
    },
  }
}

// Defaults for anything missing, recursively through plain objects; arrays and values are
// taken as saved. So a structure saved before a setting existed picks up its default.
export function fillDefaults(defaults, saved) {
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return defaults
  const out = { ...saved }
  for (const [k, v] of Object.entries(defaults)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = fillDefaults(v, saved[k])
    else if (!(k in saved)) out[k] = v
  }
  return out
}

// Fill anything missing from older or hand-edited files with defaults.
export function migrate(state) {
  const d = defaultState()
  const s = state && typeof state === 'object' ? state : {}
  const input = { ...d.input, ...(s.input ?? {}) }
  input.panels = normalisePanels(Array.isArray(input.panels) && input.panels.length ? input.panels : d.input.panels)
  input.dimensions = Array.isArray(input.dimensions) ? input.dimensions : []
  input.structure = fillDefaults(d.input.structure, s.input?.structure)
  // Control surfaces: none on a wing saved before them
  input.controls = fillDefaults(d.input.controls, s.input?.controls)
  if (!Array.isArray(input.controls.surfaces)) input.controls.surfaces = []
  if (!Array.isArray(input.controls.bays)) input.controls.bays = []
  if (!Array.isArray(input.controls.brakes)) input.controls.brakes = []
  // Every servo lies on its side now: an older bay's mounting (upright, flat) and quarter turn go
  input.controls.bays = input.controls.bays.map(({ mounting, quarterTurn, ...b }) => b)
  // Edge stock saved before the catalogue keeps its own width, rather than an auto pick
  for (const k of ['le', 'te']) {
    const saved = s.input?.structure?.[k]
    if (saved && typeof saved === 'object' && !('stock' in saved)) input.structure[k] = { ...input.structure[k], stock: 'custom' }
  }
  input.exportOptions = fillDefaults(d.input.exportOptions, s.input?.exportOptions)
  const airfoil = { ...d.airfoil, ...(s.airfoil ?? {}) }
  airfoil.custom = { ...d.airfoil.custom, ...(s.airfoil?.custom ?? {}) }
  // A drawn section that isn't a usable point list is dropped; older saves have none
  const dr = airfoil.custom.drawn
  airfoil.custom.drawn = isDrawnSection(dr) ? { pts: dr.pts, seed: typeof dr.seed === 'string' ? dr.seed : null } : null
  // Typed Clmax values (custom sections, catalogue overrides) were dropped; ignore them in older saves.
  delete airfoil.clMaxOverride
  delete airfoil.custom.clMax
  // Units were a bare system name before the per-project unit choices
  return { units: normaliseUnits(s.units), input, airfoil }
}

// localStorage if it's usable, else null (private windows, blocked storage, previews).
export function browserStorage() {
  try {
    const s = globalThis.localStorage
    const k = '__wingcalc_probe'
    s.setItem(k, k)
    s.removeItem(k)
    return s
  } catch {
    return null
  }
}

function readAll(storage) {
  try {
    const list = JSON.parse(storage?.getItem(PROJECTS_KEY) ?? '[]')
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

function writeAll(storage, list) {
  try {
    storage.setItem(PROJECTS_KEY, JSON.stringify(list))
    return true
  } catch {
    return false
  }
}

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`

export function listProjects(storage) {
  return readAll(storage)
    .map(({ id, name, savedAt }) => ({ id, name, savedAt }))
    .sort((a, b) => (b.savedAt ?? '').localeCompare(a.savedAt ?? ''))
}

export function findByName(storage, name) {
  const n = name.trim().toLowerCase()
  return readAll(storage).find((p) => p.name.trim().toLowerCase() === n) ?? null
}

// Save under the given id (updating it) or as a new project. Returns { ok, id, savedAt }.
export function saveProject(storage, { id = null, name, state }) {
  const list = readAll(storage)
  const savedAt = new Date().toISOString()
  const entry = { id: id ?? newId(), name: name.trim() || 'Untitled', savedAt, version: FORMAT_VERSION, state }
  const i = list.findIndex((p) => p.id === entry.id)
  if (i >= 0) list[i] = entry
  else list.push(entry)
  return { ok: writeAll(storage, list), id: entry.id, savedAt }
}

export function loadProject(storage, id) {
  const p = readAll(storage).find((q) => q.id === id)
  return p ? { id: p.id, name: p.name, savedAt: p.savedAt, state: migrate(p.state) } : null
}

export function deleteProject(storage, id) {
  return writeAll(
    storage,
    readAll(storage).filter((p) => p.id !== id),
  )
}

// The working state, including which saved project (if any) it came from.
export function writeAutosave(storage, { projectId, name, state }) {
  try {
    storage?.setItem(AUTOSAVE_KEY, JSON.stringify({ projectId, name, state, version: FORMAT_VERSION }))
    return true
  } catch {
    return false
  }
}

export function readAutosave(storage) {
  try {
    const a = JSON.parse(storage?.getItem(AUTOSAVE_KEY) ?? 'null')
    if (!a?.state) return null
    return { projectId: a.projectId ?? null, name: a.name ?? '', state: migrate(a.state) }
  } catch {
    return null
  }
}

// Project files, for backup and moving between browsers.
export function exportProject({ name, state }) {
  return JSON.stringify({ app: FILE_APP, version: FORMAT_VERSION, name, exportedAt: new Date().toISOString(), state }, null, 2)
}

export function importProject(text) {
  let data
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error("That file isn't valid JSON.")
  }
  if (data?.app !== FILE_APP || !data.state) throw new Error("That file isn't a Wingcalc project.")
  return { name: typeof data.name === 'string' ? data.name : 'Imported project', state: migrate(data.state) }
}

// A file-name-safe version of a project name.
export function fileName(name) {
  return `${(name || 'wing').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'wing'}.wingcalc.json`
}
