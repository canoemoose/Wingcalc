# Prompt: XFOIL in the browser spike

Paste the text below into a new Claude Code session in this repo.

---

Read `docs/scope-xfoil-wasm.md` and carry out the spike it describes: a time-boxed test of whether XFOIL can run in the browser as WebAssembly, starting with XFLR5's C++ translation of XFOIL's core compiled with Emscripten.

Work autonomously, but **ask me before downloading or installing anything** (the Emscripten SDK, XFLR5 or XFOIL sources, any binaries): tell me what, where from and roughly how big, and wait for a yes. Batch any other questions for the end.

Keep everything in `spikes/xfoil-wasm/` with its own README. Don't change the Wingcalc app, and make sure `npm run build` and `npm test` still pass. Keep large downloads and build outputs out of git.

Check results against the bundled airfoiltools.com polars in `src/data/airfoils.json`, using the cases and targets in the scope file. Record sizes, timings and convergence behaviour.

When you finish or hit the time box, write the outcome into the **Findings** section of the scope file: go/no-go, effort to integrate, risks and recommended settings. Then give me a short summary: what worked, what didn't, what you couldn't verify, and what you recommend next. Don't commit until I've seen the summary.
