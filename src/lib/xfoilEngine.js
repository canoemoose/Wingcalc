// Runs XFOIL (WebXFOIL: the Fortran compiled to WebAssembly) on one set of coordinates.
// XFOIL is driven as it would be at a terminal: keyboard input from xfoilScript(), files in
// Emscripten's in-memory file system. Its console output is discarded rather than kept, so
// a run full of non-converging iterations costs no memory. A run blocks for 0.5 to 3 s:
// call this from a worker in the browser.
//
// One engine runs one polar at a time (XFOIL keeps its state in Fortran globals).
//
// The wasm stack: WebXFOIL's callMain allocates argv on the wasm stack and never frees it,
// and XFOIL's closing Fortran STOP leaves main by throwing, so main's own stack frame is
// never popped either. Left alone, every run leaks a few hundred bytes of the stack and the
// module dies with "memory access out of bounds" after about 45 polars. So the engine
// instantiates the module itself (from a compiled module cached for the page, which also
// makes a fresh engine cheap) to reach the stack allocator, and puts the stack pointer back
// after every run. `restoresStack` says whether that worked; if it didn't (a WebXFOIL build
// with different exports), the caller should replace the engine every few dozen runs.
import createXfoilModule from 'webxfoil-wasm/dist/xfoil.js'
import { xfoilScript, parsePolarFile, toPolar, seligText, FOIL_FILE, POLAR_FILE, XFOIL_SETTINGS } from './xfoil.js'

const WORK_DIR = '/work'
// Vite turns this into the bundled asset's URL; in Node it's a file: URL.
const WASM_URL = new URL('../../node_modules/webxfoil-wasm/dist/xfoil.wasm', import.meta.url)

let compiledPromise = null

async function loadCompiled() {
  if (WASM_URL.protocol === 'file:') {
    const fsModule = 'node:fs/promises'
    const { readFile } = await import(/* @vite-ignore */ fsModule)
    return WebAssembly.compile(await readFile(WASM_URL))
  }
  if (typeof WebAssembly.compileStreaming === 'function') {
    try {
      return await WebAssembly.compileStreaming(fetch(WASM_URL, { credentials: 'same-origin' }))
    } catch {
      // Served without the wasm MIME type: fall through to compiling the bytes.
    }
  }
  const response = await fetch(WASM_URL, { credentials: 'same-origin' })
  if (!response.ok) throw new Error(`couldn't load xfoil.wasm (${response.status})`)
  return WebAssembly.compile(await response.arrayBuffer())
}

// The compiled module, shared by every engine on the page. A failed load isn't kept.
function compiledModule() {
  compiledPromise ??= loadCompiled().catch((err) => {
    compiledPromise = null
    throw err
  })
  return compiledPromise
}

// Emscripten's _emscripten_stack_alloc(size): sp = (sp - size) & -16, returns sp. The build's
// exports are minified, but it's the only exported function taking one argument (the others
// are the constructors, none, and main, two). Null if that isn't so.
function findStackAlloc(exports) {
  const fns = Object.values(exports).filter((v) => typeof v === 'function' && v.length === 1)
  if (fns.length !== 1) return null
  const alloc = fns[0]
  const sp = alloc(0)
  return alloc(0) === sp ? alloc : null
}

// moduleOptions are passed to the Emscripten factory.
export async function createXfoilEngine(moduleOptions = {}) {
  const compiled = await compiledModule()
  const io = { input: null, offset: 0 }
  let stackAlloc = null
  let failInstantiate
  const instantiateFailed = new Promise((_, reject) => { failInstantiate = reject })
  const module = await Promise.race([
    createXfoilModule({
      noInitialRun: true,
      noExitRuntime: true,
      print: () => {},
      printErr: () => {},
      stdin: () => (io.input && io.offset < io.input.length ? io.input[io.offset++] : null),
      instantiateWasm(imports, receive) {
        WebAssembly.instantiate(compiled, imports).then((instance) => {
          stackAlloc = findStackAlloc(instance.exports)
          receive(instance, compiled)
        }, failInstantiate)
        return {}
      },
      ...moduleOptions,
    }),
    instantiateFailed,
  ])
  const { FS } = module
  if (!FS.analyzePath(WORK_DIR).exists) FS.mkdir(WORK_DIR)
  FS.chdir(WORK_DIR)
  const encoder = new TextEncoder()

  // flap: { hinge, yt, deflection } (xfoil.js flapSpec) to solve with a deflected flap.
  function runPolar(coords, re, settings = XFOIL_SETTINGS, flap = null) {
    FS.writeFile(FOIL_FILE, seligText(coords))
    if (FS.analyzePath(POLAR_FILE).exists) FS.unlink(POLAR_FILE)
    io.input = encoder.encode(xfoilScript(re, settings, flap))
    io.offset = 0
    const sp = stackAlloc ? stackAlloc(0) : null
    try {
      module.callMain([])
    } catch (err) {
      // XFOIL ends with a Fortran STOP, which Emscripten reports as an exit status.
      if (err?.name !== 'ExitStatus') throw err
    } finally {
      io.input = null
      if (sp !== null) {
        // A negative size moves the stack pointer back up to where it was.
        const now = stackAlloc(0)
        if (now !== sp) stackAlloc(now - sp)
      }
    }
    const text = FS.analyzePath(POLAR_FILE).exists ? FS.readFile(POLAR_FILE, { encoding: 'utf8' }) : ''
    return toPolar(parsePolarFile(text), re, settings)
  }

  return { runPolar, restoresStack: stackAlloc !== null }
}
