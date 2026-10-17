// Where a warning is shown: beside the settings that fix it rather than in a list at the foot of
// the column. Pure, no Vue.

// The structure editor section (its fold key, less the 'structure:' prefix) whose settings fix a
// structure warning, from the warning's id (structure.js analyseStructure). Null for warnings set
// elsewhere (control surfaces, servo bays and air brakes live in the wing editor), which stay in
// the list under the editor. A foam wing has its own sections for the spar caps and the skins.
export function structureSection(id, foam = false) {
  if (!id) return null
  const spar = foam ? 'foamcaps' : 'spar'
  if (/^short-(compression|tension|webShear|webBuckling)$/.test(id) || id === 'spar-fit' || id === 'tube-short') return spar
  if (id === 'short-sheet') return foam ? 'foamcore' : 'covering'
  if (/^short-(wrinkling|core|coreShear)$/.test(id)) return 'foamcore'
  if (id === 'short-spacing' || id === 'too-close' || id === 'ribs-skipped') return 'ribs'
  if (/^(le|te)-/.test(id) || id === 'thin-te') return 'edges'
  if (id === 'finish-open') return foam ? 'finish' : 'covering'
  if (id.startsWith('gusset')) return 'gussets'
  if (id.startsWith('brace-')) return 'braces'
  if (id.startsWith('surface-')) return 'hinges'
  return null
}

// Splits warnings ({ id, message }) into those shown in a section and the rest
export function bySection(warnings, foam = false) {
  const sections = {}
  const rest = []
  for (const w of warnings) {
    const k = structureSection(w.id, foam)
    if (k) (sections[k] ??= []).push(w)
    else rest.push(w)
  }
  return { sections, rest }
}
