// XFOIL integration, pure part: the command script that drives XFOIL, parsing its polar
// file, and comparing polars. The solver itself (WebXFOIL, XFOIL compiled to WebAssembly)
// runs in a worker; see xfoilEngine.js and ../workers/xfoil.worker.js.
//
// Settings come from the spike (docs/scope-xfoil-wasm.md): 160 panels reproduce the
// airfoiltools.com polars best, ITER 50 gives the same Clmax as ITER 100 for less time, and
// sweeping out from 0° in both directions stops one bad cold-start point poisoning the run.

export const XFOIL_SETTINGS = Object.freeze({
  panels: 160,
  ncrit: 9,
  maxIter: 50,
  alphaStart: -4,
  alphaEnd: 18,
  alphaStep: 0.5,
})

// The spike's acceptance targets, reused as the threshold for warning that a computed polar
// differs from the bundled airfoiltools.com one.
export const COMPARE_THRESHOLDS = Object.freeze({ clMax: 0.03, alphaClMax: 0.5, slopePct: 3, rms: 0.02 })

// Reynolds numbers are solved on a log grid (24 steps per decade, about 10% apart), so that
// small changes to weight or chord reuse a cached polar.
const RE_STEPS_PER_DECADE = 24
export function quantiseRe(re) {
  const q = 10 ** (Math.round(Math.log10(re) * RE_STEPS_PER_DECADE) / RE_STEPS_PER_DECADE)
  return Math.round(q / 100) * 100
}

// Selig-format text: a name line, then x y from the trailing edge over the upper surface to
// the leading edge and back along the lower surface (the order coords are held in).
export function seligText(coords, name = 'Wingcalc section') {
  return `${name}\n${coords.map(([x, y]) => `${x.toFixed(6)} ${y.toFixed(6)}`).join('\n')}\n`
}

const round6 = (v) => Math.round(v * 1e6) / 1e6

// Alphas requested, in ascending order.
export function alphaGrid({ alphaStart, alphaEnd, alphaStep }) {
  const out = []
  for (let k = 0; ; k++) {
    const a = round6(alphaStart + k * alphaStep)
    if (a > alphaEnd + 1e-9) break
    out.push(a)
  }
  return out
}

export const FOIL_FILE = 'foil.dat'
export const POLAR_FILE = 'polar.txt'

// A deflected plain flap for XFOIL's GDES FLAP: the hinge's chord fraction, its height as a
// fraction of the local thickness (0.5: on the centre line, where the Mylar tabs are), and the
// deflection in degrees (+ trailing edge down). Rounded so near-identical surfaces share a
// polar: hinge to 1% of the chord, deflection to 0.5°.
export function flapSpec({ hinge, deflection, yt = 0.5 }) {
  return { hinge: Math.round(hinge * 100) / 100, yt: Math.round(yt * 100) / 100, deflection: Math.round(deflection * 2) / 2 }
}

export function flapKey(flap) {
  if (!flap) return ''
  const f = flapSpec(flap)
  return `flap:${f.hinge}/${f.yt}/${f.deflection}`
}

// XFOIL keyboard input for one viscous polar. Graphics off, load, optionally deflect a flap
// (GDES FLAP on the buffer aerofoil: hinge x, 999 to give the hinge's y as a fraction of the
// thickness, the deflection; EXEC makes it current), repanel (which also smooths the flapped
// shape onto the panels), viscous at Re, Ncrit, iteration limit, accumulate to POLAR_FILE,
// sweep 0 → end, reinitialise the boundary layer, sweep -step → start.
export function xfoilScript(re, s = XFOIL_SETTINGS, flap = null) {
  const step = Math.abs(s.alphaStep)
  const sweeps =
    s.alphaStart < 0 && s.alphaEnd > 0
      ? [`ASEQ 0 ${s.alphaEnd} ${step}`, 'INIT', `ASEQ ${-step} ${s.alphaStart} ${-step}`]
      : [`ASEQ ${s.alphaStart} ${s.alphaEnd} ${step}`]
  return [
    'PLOP', 'G F', '',
    `LOAD ${FOIL_FILE}`,
    ...(flap ? flapCommands(flap) : []),
    'PPAR', `N ${s.panels}`, '', '',
    'OPER', `VISC ${Math.round(re)}`, 'VPAR', `N ${s.ncrit}`, '', `ITER ${s.maxIter}`,
    'PACC', POLAR_FILE, '',
    ...sweeps,
    'PACC', '', 'QUIT', '',
  ].join('\n')
}

function flapCommands(flap) {
  const f = flapSpec(flap)
  return ['GDES', 'FLAP', String(f.hinge), '999', String(f.yt), String(f.deflection), 'EXEC', '']
}

// Rows of an XFOIL polar save file: everything after the dashed rule under the header.
export function parsePolarFile(text) {
  const rows = []
  let inTable = false
  for (const line of String(text).split(/\r?\n/)) {
    if (/^\s*-{4,}/.test(line)) {
      inTable = true
      continue
    }
    if (!inTable) continue
    const v = line.trim().split(/\s+/).map(Number)
    if (v.length >= 5 && v.every(Number.isFinite)) rows.push({ alpha: v[0], cl: v[1], cd: v[2], cm: v[4] })
  }
  return rows
}

// A polar from the parsed rows: converged points only, ascending alpha, plus the requested
// alphas that did not converge (XFOIL only stores converged points).
export function toPolar(rows, re, s = XFOIL_SETTINGS) {
  const byAlpha = new Map()
  for (const r of rows) byAlpha.set(round6(r.alpha).toFixed(3), r)
  const polar = { re, alpha: [], cl: [], cd: [], cm: [], failed: [], step: Math.abs(s.alphaStep) }
  for (const a of alphaGrid(s)) {
    const r = byAlpha.get(a.toFixed(3))
    if (!r) {
      polar.failed.push(a)
      continue
    }
    polar.alpha.push(a)
    polar.cl.push(r.cl)
    polar.cd.push(r.cd)
    polar.cm.push(r.cm)
  }
  return polar
}

// Runs of consecutive alphas (index ranges [start, end]) so a plot can leave gaps where
// points did not converge.
export function polarSegments({ alpha, step }) {
  const out = []
  let start = 0
  for (let i = 1; i <= alpha.length; i++) {
    if (i === alpha.length || alpha[i] - alpha[i - 1] > step * 1.5) {
      out.push([start, i - 1])
      start = i
    }
  }
  return alpha.length ? out : []
}

// Least-squares slope of Cl against alpha (per degree) over [lo, hi].
function slopeOver(alpha, cl, lo, hi) {
  const pts = alpha.map((a, i) => [a, cl[i]]).filter(([a]) => a >= lo - 1e-9 && a <= hi + 1e-9)
  if (pts.length < 3) return null
  const mx = pts.reduce((t, p) => t + p[0], 0) / pts.length
  const my = pts.reduce((t, p) => t + p[1], 0) / pts.length
  let sxy = 0
  let sxx = 0
  for (const [x, y] of pts) {
    sxy += (x - mx) * (y - my)
    sxx += (x - mx) ** 2
  }
  return sxy / sxx
}

function peak({ alpha, cl }) {
  let k = 0
  for (let i = 1; i < cl.length; i++) if (cl[i] > cl[k]) k = i
  return { clMax: cl[k], alpha: alpha[k] }
}

// Compares a computed polar against a reference one ({ alpha, cl }): Clmax, alpha at Clmax,
// lift-curve slope (-2° to 4°) and RMS Cl difference over 0° to 8° at shared alphas.
export function comparePolars(ref, calc, t = COMPARE_THRESHOLDS) {
  const r = peak(ref)
  const c = peak(calc)
  const sr = slopeOver(ref.alpha, ref.cl, -2, 4)
  const sc = slopeOver(calc.alpha, calc.cl, -2, 4)
  const refAt = new Map(ref.alpha.map((a, i) => [round6(a).toFixed(3), ref.cl[i]]))
  let ss = 0
  let n = 0
  calc.alpha.forEach((a, i) => {
    if (a < -1e-9 || a > 8 + 1e-9) return
    const v = refAt.get(round6(a).toFixed(3))
    if (v === undefined) return
    ss += (calc.cl[i] - v) ** 2
    n++
  })
  const m = {
    dClMax: c.clMax - r.clMax,
    dAlphaClMax: c.alpha - r.alpha,
    slopeErrPct: sr && sc ? (100 * (sc - sr)) / sr : null,
    rms: n ? Math.sqrt(ss / n) : null,
  }
  m.within = {
    clMax: Math.abs(m.dClMax) <= t.clMax,
    alphaClMax: Math.abs(m.dAlphaClMax) <= t.alphaClMax,
    slope: m.slopeErrPct === null || Math.abs(m.slopeErrPct) <= t.slopePct,
    rms: m.rms === null || m.rms < t.rms,
  }
  m.allWithin = Object.values(m.within).every(Boolean)
  return m
}

// Short stable key for a set of coordinates (FNV-1a over values rounded to 1e-6), for the
// polar cache.
export function coordsKey(coords) {
  let h = 0x811c9dc5
  for (const [x, y] of coords) {
    for (const v of [Math.round(x * 1e6), Math.round(y * 1e6)]) {
      h ^= v & 0xffff
      h = Math.imul(h, 0x01000193)
      h ^= (v >>> 16) & 0xffff
      h = Math.imul(h, 0x01000193)
    }
  }
  return `${coords.length}:${(h >>> 0).toString(16)}`
}

export function settingsKey(s = XFOIL_SETTINGS) {
  return `${s.panels}/${s.ncrit}/${s.maxIter}/${s.alphaStart}/${s.alphaEnd}/${s.alphaStep}`
}
