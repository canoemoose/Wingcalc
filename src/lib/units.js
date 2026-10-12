// Unit definitions and conversion. Every quantity has an SI base unit, and each unit
// carries a factor: value_in_base = value_in_unit × factor.
//
// Base units: length m, area m², mass kg, wing loading kg/m², cube loading kg/m³, speed m/s.
// `thin` is a length too, for material sizes, shown to a tenth of a millimetre. `percent` is
// a fraction (0.12 is 12%).

const OZ = 0.028349523125 // kg
const LB = 0.45359237 // kg
const IN = 0.0254 // m
const FT = 0.3048 // m

export const UNITS = {
  length: {
    mm: { factor: 0.001, label: 'mm', dp: 0 },
    m: { factor: 1, label: 'm', dp: 3 },
    in: { factor: IN, label: 'in', dp: 2 },
    ft: { factor: FT, label: 'ft', dp: 3 },
  },
  thin: {
    mm: { factor: 0.001, label: 'mm', dp: 1 },
    in: { factor: IN, label: 'in', dp: 3 },
  },
  percent: {
    pct: { factor: 0.01, label: '%', dp: 1 },
  },
  area: {
    dm2: { factor: 0.01, label: 'dm²', dp: 2 },
    m2: { factor: 1, label: 'm²', dp: 4 },
    in2: { factor: IN * IN, label: 'in²', dp: 1 },
    ft2: { factor: FT * FT, label: 'ft²', dp: 3 },
  },
  mass: {
    g: { factor: 0.001, label: 'g', dp: 0 },
    kg: { factor: 1, label: 'kg', dp: 3 },
    oz: { factor: OZ, label: 'oz', dp: 2 },
    lb: { factor: LB, label: 'lb', dp: 3 },
  },
  wingLoading: {
    gdm2: { factor: 0.1, label: 'g/dm²', dp: 1 },
    kgm2: { factor: 1, label: 'kg/m²', dp: 2 },
    ozft2: { factor: OZ / (FT * FT), label: 'oz/ft²', dp: 1 },
  },
  cubeLoading: {
    gdm3: { factor: 1, label: 'g/dm³', dp: 1 },
    ozft3: { factor: OZ / (FT * FT * FT), label: 'oz/ft³', dp: 1 },
  },
  speed: {
    ms: { factor: 1, label: 'm/s', dp: 1 },
    kmh: { factor: 1 / 3.6, label: 'km/h', dp: 1 },
    mph: { factor: 0.44704, label: 'mph', dp: 1 },
  },
}

// Units offered for each quantity in each system; the first is the default.
export const SYSTEMS = {
  metric: {
    label: 'Metric',
    length: ['mm', 'm'],
    thin: ['mm'],
    percent: ['pct'],
    area: ['dm2', 'm2'],
    mass: ['g', 'kg'],
    wingLoading: ['gdm2', 'kgm2'],
    cubeLoading: ['gdm3'],
    speed: ['kmh', 'ms'],
  },
  imperial: {
    label: 'Imperial',
    length: ['in', 'ft'],
    thin: ['in'],
    percent: ['pct'],
    area: ['in2', 'ft2'],
    mass: ['oz', 'lb'],
    wingLoading: ['ozft2'],
    cubeLoading: ['ozft3'],
    speed: ['mph'],
  },
}

// A project's units: the system, and within it the unit for lengths, weights and speeds.
// Areas follow the length unit and wing loading the weight unit, so the figures read together
// (mm with dm² and g/dm², m with m² and kg/m²). Every other quantity has one unit per system.
export const CHOICES = {
  metric: { length: ['mm', 'm'], mass: ['g', 'kg'], speed: ['kmh', 'ms'] },
  imperial: { length: ['in', 'ft'], mass: ['oz', 'lb'], speed: ['mph'] },
}
const AREA_FOR = { mm: 'dm2', m: 'm2', in: 'in2', ft: 'ft2' }
const LOADING_FOR = { g: 'gdm2', kg: 'kgm2', oz: 'ozft2', lb: 'ozft2' }

// A units setting from anything saved: a system name (as saves before the setting were), or
// a setting with any unknown choice put back to the system's first.
export function normaliseUnits(saved) {
  const system = (typeof saved === 'string' ? saved : saved?.system) === 'imperial' ? 'imperial' : 'metric'
  const out = { system }
  for (const [q, list] of Object.entries(CHOICES[system])) out[q] = list.includes(saved?.[q]) ? saved[q] : list[0]
  return out
}

// The system name of a units setting (or of a bare system name)
export const systemOf = (units) => (typeof units === 'string' ? units : units?.system) ?? 'metric'

export function otherSystem(units) {
  return systemOf(units) === 'metric' ? 'imperial' : 'metric'
}

export function toBase(value, quantity, unit) {
  return value * UNITS[quantity][unit].factor
}

export function fromBase(value, quantity, unit) {
  return value / UNITS[quantity][unit].factor
}

export function convert(value, quantity, fromUnit, toUnit) {
  return fromBase(toBase(value, quantity, fromUnit), quantity, toUnit)
}

// The unit a quantity is shown in, for a units setting or a bare system name (its first units)
export function defaultUnit(units, quantity) {
  const sys = systemOf(units)
  if (typeof units === 'string' || !units) return SYSTEMS[sys][quantity][0]
  if (quantity === 'length' || quantity === 'mass' || quantity === 'speed') return normaliseUnits(units)[quantity]
  if (quantity === 'area') return AREA_FOR[normaliseUnits(units).length]
  if (quantity === 'wingLoading') return LOADING_FOR[normaliseUnits(units).mass]
  return SYSTEMS[sys][quantity][0]
}

// Format a base-unit value in the given unit, e.g. "1,250 g". Uses UK number formatting.
export function format(value, quantity, unit, dp) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '–'
  const def = UNITS[quantity][unit]
  const n = fromBase(value, quantity, unit)
  const places = dp ?? def.dp
  const text = n.toLocaleString('en-GB', {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  })
  return `${text} ${def.label}`
}

// Round a number for an input box: the unit's display precision, no trailing zeros.
export function inputValue(value, quantity, unit) {
  if (value === null || value === undefined || !Number.isFinite(value)) return ''
  const def = UNITS[quantity][unit]
  const n = fromBase(value, quantity, unit)
  return String(Number(n.toFixed(def.dp)))
}
