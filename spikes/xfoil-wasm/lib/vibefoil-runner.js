// Drives Vibefoil's pure-JavaScript XFOIL port headlessly, through its own
// solver worker module. Its module sets self.onmessage and calls self.postMessage, so
// we take its handler and intercept postMessage only while it solves. Works in Node
// (where `self` is stubbed) and inside our own Web Worker.
// Custom coordinates are repanelled with Vibefoil's PANGEN first, as XFOIL's PANE does;
// the Vibefoil app itself skips this for loaded files.
import { alphaGrid } from './metrics.js';

let worker = null;
let reply = null;
export async function load() {
  if (worker) return worker;
  if (typeof globalThis.self === 'undefined') globalThis.self = {};
  const ownHandler = self.onmessage;
  await import('../vendor/vibefoil/js/solver_worker.js');
  const { pangen } = await import('../vendor/vibefoil/js/xfoil.js');
  worker = { onmessage: self.onmessage, pangen };
  self.onmessage = ownHandler ?? null;
  return worker;
}

function parseSelig(text) {
  const x = [], y = [];
  for (const line of text.split('\n').slice(1)) {
    const v = line.trim().split(/\s+/).map(Number);
    if (v.length === 2 && v.every(Number.isFinite)) { x.push(v[0]); y.push(v[1]); }
  }
  return { x, y };
}

let runId = 0;
export async function runPolar(coordsText, opts) {
  const { re, ncrit = 9, alphaStart, alphaEnd, alphaStep, maxIter = 100, panels = 160, split = true } = opts;
  const w = await load();
  const raw = parseSelig(coordsText);
  const pan = w.pangen(Float64Array.from(raw.x), Float64Array.from(raw.y), raw.x.length, { npan: panels });
  const custom = { name: 'foil', nb: pan.n, x: Array.from(pan.x), y: Array.from(pan.y) };
  runId += 1;

  const solve = (alphaDeg, key, reuseState) => {
    const settings = {
      source: 'custom', custom, flap: { x: 0.75, yrel: 0.5, deflection: 0 },
      alphaDeg, alphaRad: (alphaDeg * Math.PI) / 180, geometryKey: key,
      advancedMode: false, reusePanel: true, reuseSolution: false, reuseState,
      viscous: true, mach: 0, reynolds: re, ncr: ncrit, nIter: maxIter,
      canvasWidth: 800, canvasHeight: 400,
    };
    w.onmessage({ data: { requestId: 1, settings } });
    if (!reply.ok) throw new Error(reply.error);
    return reply;
  };
  const sweep = (alphas, key) => {
    const out = [];
    let state = null;
    for (const a of alphas) {
      const r = solve(a, key, state);
      state = r.reuseState;
      out.push({ alpha: a, cl: r.coeffs.CL, cd: r.coeffs.CD, cm: r.coeffs.CM, converged: r.converged });
    }
    return out;
  };

  const grid = alphaGrid(alphaStart, alphaEnd, alphaStep);
  // The port logs every iteration via console.log; mute it for the solve.
  const { log, info } = console;
  console.log = console.info = () => {};
  const hadOwnPost = Object.prototype.hasOwnProperty.call(self, 'postMessage');
  const realPost = self.postMessage;
  self.postMessage = (msg) => { reply = msg; };
  const t0 = performance.now();
  let points;
  try {
  if (split && alphaStart < 0 && alphaEnd > 0) {
    const up = sweep(grid.filter((a) => a >= 0), `run${runId}:up`);
    const down = sweep(grid.filter((a) => a < 0).reverse(), `run${runId}:down`);
    points = [...down.reverse(), ...up];
  } else {
    points = sweep(grid, `run${runId}`);
  }
  } finally {
    console.log = log; console.info = info;
    if (hadOwnPost) self.postMessage = realPost; else delete self.postMessage;
  }
  return { points, ms: performance.now() - t0 };
}
