// Where a warning is shown: beside the settings that fix it rather than in a list at the foot of
// the column. Pure, no Vue.

// The structure editor section (its fold key, less the 'structure:' prefix) whose settings fix a
// structure warning, from the warning's id (structure.js analyseStructure). Null for warnings set
// elsewhere (air brakes and their servo bays live in the wing editor), which stay in the list
// under the editor. A foam wing has its own section for the core and skins.
export function structureSection(id, foam = false) {
  if (!id) return null
  const spar = 'spar'
  if (/^short-(compression|tension|webShear|sparShear|webBuckling)$/.test(id) || id === 'spar-fit' || id === 'tube-short') return spar
  if (id === 'short-sheet') return foam ? 'foamcore' : 'covering'
  if (/^short-(wrinkling|coreShear)$/.test(id)) return 'foamcore'
  if (id === 'short-spacing' || id === 'too-close' || id === 'ribs-skipped' || id === 'rib-pitch-covering') return 'ribs'
  if (/^(le|te)-/.test(id) || id === 'thin-te') return 'edges'
  if (id === 'finish-open') return 'finish'
  if (id.startsWith('gusset')) return 'gussets'
  if (id.startsWith('brace-')) return 'braces'
  if (id.startsWith('stringer-')) return 'stringers'
  if (id.startsWith('surface-')) return 'hinges'
  // Each surface's linkage, in that surface's own section (SurfaceStructure.vue)
  if (id.startsWith('linkage-')) return 'surfaces'
  // A control surface's servo bay (its id is the surface's, a number), in that surface's section
  // too; an air brake's (bay-b…) stays in the list
  if (/^bay-\d+(-|$)/.test(id)) return 'surfaces'
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
