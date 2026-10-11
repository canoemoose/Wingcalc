// Module worker: runs one polar per message with the chosen engine.
const engines = {
  webxfoil: () => import('../lib/webxfoil-runner.js'),
  vibefoil: () => import('../lib/vibefoil-runner.js'),
};

self.addEventListener('message', async (event) => {
  const { id, engine, coordsText, opts } = event.data;
  try {
    const t0 = performance.now();
    const runner = await engines[engine]();
    if (runner.load) await runner.load();
    const loadMs = performance.now() - t0;
    const r = await runner.runPolar(coordsText, opts);
    const heapMB = runner.memoryBytes ? runner.memoryBytes() / 1048576 : null;
    self.postMessage({ id, ok: true, loadMs, ...r, heapMB });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err && err.stack || err) });
  }
});
