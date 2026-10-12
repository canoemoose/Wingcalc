import { describe, it, expect } from 'vitest'
import {
  defaultState,
  migrate,
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
} from '../src/lib/projects.js'

// In-memory stand-in for localStorage
function memoryStorage() {
  const m = new Map()
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  }
}

const failingStorage = {
  getItem: () => {
    throw new Error('blocked')
  },
  setItem: () => {
    throw new Error('blocked')
  },
}

describe('saving and opening projects', () => {
  it('round-trips a project', () => {
    const st = memoryStorage()
    const state = defaultState()
    state.input.mass = 2.2
    const { ok, id } = saveProject(st, { name: 'Sport 40', state })
    expect(ok).toBe(true)
    const p = loadProject(st, id)
    expect(p.name).toBe('Sport 40')
    expect(p.state.input.mass).toBe(2.2)
  })

  it('updates in place when saved again with the same id', () => {
    const st = memoryStorage()
    const { id } = saveProject(st, { name: 'A', state: defaultState() })
    saveProject(st, { id, name: 'A renamed', state: defaultState() })
    expect(listProjects(st)).toHaveLength(1)
    expect(listProjects(st)[0].name).toBe('A renamed')
  })

  it('lists newest first, finds by name and deletes', () => {
    const st = memoryStorage()
    saveProject(st, { name: 'First', state: defaultState() })
    const { id } = saveProject(st, { name: 'Second', state: defaultState() })
    expect(findByName(st, ' second ').id).toBe(id)
    deleteProject(st, id)
    expect(listProjects(st).map((p) => p.name)).toEqual(['First'])
  })

  it('names untitled projects', () => {
    const st = memoryStorage()
    saveProject(st, { name: '  ', state: defaultState() })
    expect(listProjects(st)[0].name).toBe('Untitled')
  })

  it('copes with storage that is missing, blocked or corrupt', () => {
    expect(listProjects(null)).toEqual([])
    expect(listProjects(failingStorage)).toEqual([])
    expect(saveProject(failingStorage, { name: 'x', state: defaultState() }).ok).toBe(false)
    expect(readAutosave(failingStorage)).toBeNull()
    const st = memoryStorage()
    st.setItem('wingcalc.projects.v1', '{not json')
    expect(listProjects(st)).toEqual([])
  })
})

describe('autosave', () => {
  it('restores the working state and which project it belongs to', () => {
    const st = memoryStorage()
    const state = defaultState()
    state.units = { system: 'imperial', length: 'ft', mass: 'lb', speed: 'mph' }
    writeAutosave(st, { projectId: 'abc', name: 'Work', state })
    const a = readAutosave(st)
    expect(a.projectId).toBe('abc')
    expect(a.state.units).toEqual({ system: 'imperial', length: 'ft', mass: 'lb', speed: 'mph' })
  })
})

describe('migration', () => {
  it('fills missing fields from defaults and gives panels ids', () => {
    const s = migrate({ input: { mass: 3, panels: [{ length: 0.5, tipChord: 0.2, dihedral: 2 }] } })
    expect(s.input.mass).toBe(3)
    expect(s.input.rootChord).toBe(0.25)
    expect(s.input.panels[0].id).toBeDefined()
    expect(s.input.panels[0].stations).toBeNull()
    expect(s.input.dimensions).toEqual([])
    expect(s.airfoil.custom.thicknessPct).toBe(12)
    expect(s.units).toEqual({ system: 'metric', length: 'mm', mass: 'g', speed: 'kmh' })
  })

  it('turns a bare unit system from older saves into a units setting', () => {
    expect(migrate({ units: 'imperial' }).units).toEqual({ system: 'imperial', length: 'in', mass: 'oz', speed: 'mph' })
    // A choice from the other system goes back to this one's first
    expect(migrate({ units: { system: 'imperial', length: 'mm', mass: 'lb' } }).units).toEqual({ system: 'imperial', length: 'in', mass: 'lb', speed: 'mph' })
  })

  it('drops typed Clmax values from older saves', () => {
    const s = migrate({ airfoil: { source: 'other', id: 'x', clMaxOverride: 1.5, custom: { clMax: 1.3, camberPct: 4 } } })
    expect('clMaxOverride' in s.airfoil).toBe(false)
    expect('clMax' in s.airfoil.custom).toBe(false)
    expect(s.airfoil.custom.camberPct).toBe(4)
  })

  it('survives rubbish', () => {
    expect(migrate(null).input.panels).toHaveLength(1)
    expect(migrate({ input: { panels: 'nope' } }).input.panels).toHaveLength(1)
  })
})

describe('project files', () => {
  it('exports and imports', () => {
    const state = defaultState()
    state.input.fuselageWidth = 0.1
    const back = importProject(exportProject({ name: 'Glider', state }))
    expect(back.name).toBe('Glider')
    expect(back.state.input.fuselageWidth).toBe(0.1)
  })

  it('rejects files that are not projects', () => {
    expect(() => importProject('not json')).toThrow(/valid JSON/)
    expect(() => importProject('{"hello":1}')).toThrow(/Wingcalc project/)
  })

  it('makes safe file names', () => {
    expect(fileName('My wing: v2/final')).toBe('My-wing-v2final.wingcalc.json')
    expect(fileName('')).toBe('wing.wingcalc.json')
  })
})

describe('structure in saved projects', () => {
  it('fills settings added since a project was saved', () => {
    const old = defaultState()
    delete old.input.exportOptions
    old.input.structure = { spar: { type: 'tube', tubeDiameter: 0.01 }, ribs: { manual: [{ id: 1, d: 0.1 }] } }
    const m = migrate(old)
    expect(m.input.structure.spar.type).toBe('tube')
    expect(m.input.structure.spar.tubeDiameter).toBe(0.01)
    expect(m.input.structure.spar.capWidth).toBe(0.006)
    expect(m.input.structure.ribs.manual).toEqual([{ id: 1, d: 0.1 }])
    expect(m.input.structure.covering.type).toBe('dbox')
    expect(m.input.exportOptions.machine).toBe('laser')
  })
})
