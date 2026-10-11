// Runs XFOIL (WebXFOIL: the Fortran compiled to WebAssembly) on one set of coordinates.
// XFOIL is driven as it would be at a terminal: keyboard input from xfoilScript(), files in
// Emscripten's in-memory file system. Its console output is discarded rather than kept, so
// a run full of non-converging iterations costs no memory. A run blocks for 0.5 to 3 s:
// call this from a worker in the browser.
//
// One engine runs one polar at a time (XFOIL keeps its state in Fortran globals).
import createXfoilModule from 'webxfoil-wasm/dist/xfoil.js'
import { xfoilScript, parsePolarFile, toPolar, seligText, FOIL_FILE, POLAR_FILE, XFOIL_SETTINGS } from './xfoil.js'

const WORK_DIR = '/work'

// moduleOptions are passed to the Emscripten factory (e.g. wasmBinary in tests).
export async function createXfoilEngine(moduleOptions = {}) {
  const io = { input: null, offset: 0 }
  const module = await createXfoilModule({
    noInitialRun: true,
    noExitRuntime: true,
    print: () => {},
    printErr: () => {},
    stdin: () => (io.input && io.offset < io.input.length ? io.input[io.offset++] : null),
    ...moduleOptions,
  })
  const { FS } = module
  if (!FS.analyzePath(WORK_DIR).exists) FS.mkdir(WORK_DIR)
  FS.chdir(WORK_DIR)
  const encoder = new TextEncoder()

  function runPolar(coords, re, settings = XFOIL_SETTINGS) {
    FS.writeFile(FOIL_FILE, seligText(coords))
    if (FS.analyzePath(POLAR_FILE).exists) FS.unlink(POLAR_FILE)
    io.input = encoder.encode(xfoilScript(re, settings))
    io.offset = 0
    try {
      module.callMain([])
    } catch (err) {
      // XFOIL ends with a Fortran STOP, which Emscripten reports as an exit status.
      if (err?.name !== 'ExitStatus') throw err
    } finally {
      io.input = null
    }
    const text = FS.analyzePath(POLAR_FILE).exists ? FS.readFile(POLAR_FILE, { encoding: 'utf8' }) : ''
    return toPolar(parsePolarFile(text), re, settings)
  }

  return { runPolar }
}
