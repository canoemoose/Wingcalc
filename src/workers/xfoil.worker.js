// Module worker that runs XFOIL polars off the main thread. Messages in:
// { id, coords, re, settings, flap? }; out: { id, ok, polar, ms } or { id, ok: false, error }.
import { createXfoilEngine } from '../lib/xfoilEngine.js'

// An engine that can't put the wasm stack back after a run (xfoilEngine.js) leaks a little
// of it each time and dies after about 45 runs, so it's replaced well before that.
const REBUILD_EVERY = 30

let enginePromise = null
let runs = 0

function dropEngine() {
  enginePromise = null
  runs = 0
}

self.onmessage = async (event) => {
  const { id, coords, re, settings, flap = null } = event.data
  try {
    enginePromise ??= createXfoilEngine()
    const engine = await enginePromise
    const t0 = performance.now()
    const polar = engine.runPolar(coords, re, settings, flap)
    if (!engine.restoresStack && ++runs >= REBUILD_EVERY) dropEngine()
    self.postMessage({ id, ok: true, polar, ms: performance.now() - t0 })
  } catch (err) {
    // A failed start isn't kept, and an engine that threw mid-run may have corrupt state:
    // the next message starts a fresh one (cheap: the compiled module is cached).
    dropEngine()
    self.postMessage({ id, ok: false, error: String(err?.message ?? err) })
  }
}
