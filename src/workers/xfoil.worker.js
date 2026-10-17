// Module worker that runs XFOIL polars off the main thread. Messages in:
// { id, coords, re, settings, flap? }; out: { id, ok, polar, ms } or { id, ok: false, error }.
import { createXfoilEngine } from '../lib/xfoilEngine.js'

let enginePromise = null

self.onmessage = async (event) => {
  const { id, coords, re, settings, flap = null } = event.data
  try {
    enginePromise ??= createXfoilEngine()
    const engine = await enginePromise
    const t0 = performance.now()
    const polar = engine.runPolar(coords, re, settings, flap)
    self.postMessage({ id, ok: true, polar, ms: performance.now() - t0 })
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err?.message ?? err) })
  }
}
