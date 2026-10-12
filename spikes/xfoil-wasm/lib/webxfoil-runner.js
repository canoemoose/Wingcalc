// Drives WebXFOIL (XFOIL Fortran compiled to wasm) through its command interface.
import { WebXFOIL } from '../node_modules/webxfoil-wasm/index.js';
import { alphaGrid } from './metrics.js';

let instance = null;
let memory = null;
export async function load(options) {
  if (instance) return instance;
  // The module does not export its heap, so catch the wasm memory on instantiation.
  const wrap = (fn) => async (...a) => {
    const r = await fn.apply(WebAssembly, a);
    const exp = (r.instance ?? r).exports;
    memory = Object.values(exp).find((v) => v instanceof WebAssembly.Memory) ?? memory;
    return r;
  };
  const { instantiate, instantiateStreaming } = WebAssembly;
  WebAssembly.instantiate = wrap(instantiate);
  if (instantiateStreaming) WebAssembly.instantiateStreaming = wrap(instantiateStreaming);
  try {
    instance = await WebXFOIL.load(options);
  } finally {
    WebAssembly.instantiate = instantiate;
    if (instantiateStreaming) WebAssembly.instantiateStreaming = instantiateStreaming;
  }
  return instance;
}

function parsePolarFile(text) {
  const rows = [];
  let inTable = false;
  for (const line of text.split('\n')) {
    if (/^\s*-{4,}/.test(line)) { inTable = true; continue; }
    if (!inTable) continue;
    const v = line.trim().split(/\s+/).map(Number);
    if (v.length >= 5 && v.every(Number.isFinite)) rows.push({ alpha: v[0], cl: v[1], cd: v[2], cdp: v[3], cm: v[4] });
  }
  return rows;
}

/**
 * Viscous polar. `split` runs 0 -> alphaEnd and 0 -> alphaStart as two sweeps,
 * each warm-started from the previous point (the usual XFOIL practice).
 * Returns per-alpha rows with a converged flag (XFOIL stores converged points only).
 */
export async function runPolar(coordsText, opts) {
  const { re, ncrit = 9, alphaStart, alphaEnd, alphaStep, maxIter = 100, panels = 160, split = true, init = false } = opts;
  const x = await load();
  const seq = (a, b) => {
    const step = b >= a ? Math.abs(alphaStep) : -Math.abs(alphaStep);
    return [init ? 'INIT' : null, `ASEQ ${a} ${b} ${step}`].filter(Boolean);
  };
  const sweeps = split && alphaStart < 0 && alphaEnd > 0
    ? [...seq(0, alphaEnd), 'INIT', ...seq(-alphaStep, alphaStart)]
    : seq(alphaStart, alphaEnd);
  const lines = [
    'PLOP', 'G F', '',
    'LOAD foil.dat',
    'PPAR', `N ${panels}`, '', '',
    'OPER', `VISC ${re}`, 'VPAR', `N ${ncrit}`, '', `ITER ${maxIter}`,
    'PACC', 'polar.txt', '',
    ...sweeps,
    'PACC', '', 'QUIT', '',
  ];
  try { x.FS.unlink('/work/polar.txt'); } catch { /* first run */ }
  const t0 = performance.now();
  const { raw } = x.run(lines.join('\n'), { files: [{ path: 'foil.dat', data: coordsText }] });
  const ms = performance.now() - t0;
  let rows = [];
  try { rows = parsePolarFile(x.readFile('/work/polar.txt')); } catch { /* no polar written */ }
  const byKey = new Map(rows.map((r) => [r.alpha.toFixed(3), r]));
  const points = alphaGrid(alphaStart, alphaEnd, alphaStep).map((a) => {
    const r = byKey.get(a.toFixed(3));
    return r ? { ...r, converged: true } : { alpha: a, converged: false };
  });
  return { points, ms, stdoutBytes: raw.stdout.length };
}

// Current size of the wasm linear memory (it only grows), for peak-memory reporting.
export function memoryBytes() {
  return memory ? memory.buffer.byteLength : null;
}
