// Cross-checks two engine result files against each other (Cl RMS 0-8 deg, Clmax),
// and WebXFOIL drag against the cached airfoiltools CSVs (scripts/.cache, if present).
// Usage: node cross-check.mjs results/webxfoil-p160-split.json results/vibefoil-p160-split.json
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const [fa, fb] = process.argv.slice(2);
const A = JSON.parse(fs.readFileSync(fa, 'utf8')), B = JSON.parse(fs.readFileSync(fb, 'utf8'));
const cacheDir = fileURLToPath(new URL('../../scripts/.cache/', import.meta.url));

function refCsv(id, re) {
  const f = `${cacheDir}airfoiltools.com_polar_csv_polar_xf-${id}-${re}`;
  if (!fs.existsSync(f)) return null;
  const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
  const h = lines.findIndex((l) => l.startsWith('Alpha,'));
  const m = new Map();
  for (const l of lines.slice(h + 1)) { const v = l.split(',').map(Number); if (v.length >= 5 && v.every(Number.isFinite)) m.set(v[0].toFixed(2), { cl: v[1], cd: v[2], cm: v[4] }); }
  return m;
}

console.log(`case            Re      ${A.engine} vs ${B.engine}: RMS dCl 0-8, dClmax | ${A.engine} vs ref: RMS dCd/Cd 0-8 (%), RMS dCm 0-8`);
for (const ra of A.results) {
  const rb = B.results.find((x) => x.id === ra.id && x.re === ra.re);
  const mb = new Map(rb.points.filter((p) => p.converged).map((p) => [p.alpha.toFixed(2), p]));
  let ss = 0, n = 0;
  for (const p of ra.points) {
    if (!p.converged || p.alpha < 0 || p.alpha > 8) continue;
    const q = mb.get(p.alpha.toFixed(2)); if (!q) continue;
    ss += (p.cl - q.cl) ** 2; n++;
  }
  const ref = refCsv(ra.id, ra.re);
  let sd = 0, sm = 0, nd = 0;
  if (ref) for (const p of ra.points) {
    if (!p.converged || p.alpha < 0 || p.alpha > 8) continue;
    const r = ref.get(p.alpha.toFixed(2)); if (!r) continue;
    sd += ((p.cd - r.cd) / r.cd) ** 2; sm += (p.cm - r.cm) ** 2; nd++;
  }
  console.log(`${ra.id.padEnd(14)} ${String(ra.re).padStart(7)}   ${Math.sqrt(ss / n).toFixed(4)}  ${(ra.metrics.clmaxCalc - rb.metrics.clmaxCalc).toFixed(3).padStart(7)}`
    + `   |   ${nd ? (100 * Math.sqrt(sd / nd)).toFixed(1).padStart(5) : '  -  '}   ${nd ? Math.sqrt(sm / nd).toFixed(4) : '-'}`);
}
