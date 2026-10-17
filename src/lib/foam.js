// Foam-core construction: the materials, the settings, and the sandwich formulas the
// structure check uses for a veneered foam wing (structure.js analyseStructure).
//
// A foam wing is a hot-wire cut core of expanded or extruded polystyrene, skinned top and
// bottom with obechi veneer or balsa sheet, and leading and trailing edge stock as on a built-up
// wing. There are no ribs and no spar: the skins carry the bending and the core the shear.
//
// For everything that follows the section (the skin's place in bending, the hinge spars, servo
// bays, air brakes, the 3D view) a foam wing is laid out as a fully sheeted built-up wing with
// no ribs and no spar: foamStructure() makes that equivalent structure, and the check swaps the
// spar and rib-dependent modes for the sandwich ones (skin crushing, face wrinkling and core
// shear). All values SI: metres, pascals, kg/m³.
//
// No imports from structure.js, which imports this (its MATERIALS take these in).

// Foams. E is the compressive (out-of-plane) modulus, G the shear modulus, compression the
// stress at 10% strain, shear the shear strength: conservative indicative values for the EN
// 13163 (EPS) and EN 13164 (XPS) classes, see docs/methods.md. Tension isn't used.
// Skins and caps: obechi from the USDA Wood Handbook and Wood Database figures, taken down;
// wet-laid carbon tow at a hand lay-up's fibre fraction.
export const FOAM_MATERIALS = {
  'eps-15': { label: 'EPS foam, 15 kg/m³ (EPS 70)', short: 'EPS 15', density: 15, E: 2.5e6, G: 1.0e6, compression: 70e3, tension: 100e3, shear: 50e3, foam: true },
  'eps-20': { label: 'EPS foam, 20 kg/m³ (EPS 100)', short: 'EPS 20', density: 20, E: 4e6, G: 1.6e6, compression: 100e3, tension: 150e3, shear: 75e3, foam: true },
  'eps-30': { label: 'EPS foam, 30 kg/m³ (EPS 200)', short: 'EPS 30', density: 30, E: 7e6, G: 2.8e6, compression: 200e3, tension: 250e3, shear: 135e3, foam: true },
  xps: { label: 'XPS foam, 33 kg/m³ (blue or pink foam)', short: 'XPS', density: 33, E: 10e6, G: 4e6, compression: 250e3, tension: 300e3, shear: 200e3, foam: true },
  obechi: { label: 'Obechi veneer', short: 'obechi', density: 380, E: 6e9, compression: 22e6, tension: 35e6, shear: 4e6 },
  'carbon-tow': { label: 'Carbon tow (wet laid)', short: 'carbon tow', density: 1500, E: 80e9, compression: 300e6, tension: 700e6, shear: 30e6 },
  // What the hot-wire and routing templates are cut from: not part of the wing, so it weighs nothing
  'template-stock': { label: 'Template stock (laminate, hardboard or ply)', short: 'template stock', density: 0, E: 0, compression: 0, tension: 0, shear: 0 },
}

export const FOAMS = ['eps-15', 'eps-20', 'eps-30', 'xps']
export const SKIN_MATERIALS = ['obechi', 'balsa-light', 'balsa-medium']

// The size of a sheet of skin material as it's sold, when the settings don't give one: obechi
// veneer about 300 mm by 1 m, balsa sheet 100 mm by 915 mm (36 in)
export const SKIN_SHEETS = {
  obechi: { width: 0.3, length: 1.0 },
  default: { width: 0.1, length: 0.915 },
}
export const skinSheet = (skin) => {
  const d = SKIN_SHEETS[skin.material] ?? SKIN_SHEETS.default
  return { width: skin.sheetWidth > 0 ? skin.sheetWidth : d.width, length: skin.sheetLength > 0 ? skin.sheetLength : d.length }
}

// Thickness of the hot-wire and routing templates' stock, for the cut list and DXF grouping
export const TEMPLATE_THICKNESS = 0.0015
// The least core depth worth cutting: closer to the nose or tail than this, the skins meet
export const MIN_CORE = 0.0005
// Wrinkling coefficient: σ = Q (E_f E_c G_c)^(1/3). 0.825 in theory (Hoff and Mautner); 0.5
// is the usual design value, covering imperfect bonds and core variation.
export const WRINKLE_Q = 0.5

// A new foam wing's settings: EPS 20, 0.6 mm obechi, a 6 × 0.5 mm carbon strip under each skin,
// no shear web, 100 g/m² of epoxy per square metre of skin.
export function defaultFoam() {
  return {
    core: 'eps-20',
    // sheetWidth, sheetLength: the sheets the skin is cut from, null for the material's usual size
    skin: { material: 'obechi', thickness: 0.0006, sheetWidth: null, sheetLength: null },
    glue: 0.1, // kg/m² of skin: the epoxy bonding it to the core
  }
}

export const isFoam = (structure) => structure?.construction === 'foam'

// The built-up structure a foam wing is laid out as: a full-chord skin with no spar, ribs,
// stringers, cap strips or gussets. The spar's position is kept as the reference line servo
// bays and air brakes are placed against. construction and foam are kept, so anything downstream can
// still tell.
export function foamStructure(structure) {
  const f = structure.foam ?? defaultFoam()
  return {
    ...structure,
    spar: { ...structure.spar, type: 'none', webThickness: 0 },
    covering: { ...structure.covering, type: 'sheeted', sheetThickness: f.skin.thickness, sheetMaterial: f.skin.material, capStrips: false },
    stringers: [],
    ribs: { ...structure.ribs, thickness: 0, spacing: 'uniform', manual: [], hardPoints: [], lightening: false, jigTabs: false },
    gussets: { ...structure.gussets, le: false, te: false },
  }
}

// --- Sandwich formulas ---------------------------------------------------------------------

// Face wrinkling stress of a skin of modulus Ef bonded to a core of modulus Ec and shear
// modulus Gc (thick core, thin face): σ = Q (Ef Ec Gc)^(1/3). Allen (1969), Zenkert (1995).
export function wrinklingStress(Ef, core, Q = WRINKLE_Q) {
  if (!(Ef > 0) || !(core?.E > 0) || !(core?.G > 0)) return 0
  return Q * Math.cbrt(Ef * core.E * core.G)
}

// Shear stress in a sandwich's core carrying shear force V across a width b, its depth d between
// the faces (thin-face theory): tau = V / (b d).
export function coreShearStress(V, { width, d }) {
  if (!(d > 0) || !(width > 0)) return Infinity
  return Math.abs(V) / (width * d)
}
