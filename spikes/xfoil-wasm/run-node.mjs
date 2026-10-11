// Runs the step 5 cases in Node against the bundled reference polars.
// Usage: node run-node.mjs [webxfoil|vibefoil] [--case naca2412-il] [--re 200000] [--panels 160] [--iter 100] [--nosplit] [--json out.json]
import fs from 'node:fs';
import { CASES, referencePolar, seligText, section } from './lib/reference.js';
import { compare } from './lib/metrics.js';

const args = process.argv.slice(2);
const engine = args[0] && !args[0].startsWith('--') ? args[0] : 'webxfoil';
const opt = (name, d) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : d; };
const flag = (name) => args.includes(`--${name}`);

const runner = engine === 'vibefoil' ? await import('./lib/vibefoil-runner.js') : await import('./lib/webxfoil-runner.js');
const settings = {
  ncrit: 9, alphaStart: -4, alphaEnd: 18, alphaStep: 0.25,
  maxIter: +opt('iter', 100), panels: +opt('panels', 160), split: !flag('nosplit'), init: flag('init'),
};

let cases = CASES.flatMap((c) => c.re.map((re) => ({ id: c.id, re })));
if (opt('case')) cases = cases.filter((c) => c.id === opt('case'));
if (opt('re')) cases = cases.filter((c) => c.re === +opt('re'));

const results = [];
const f = (v, d = 3) => (Number.isFinite(v) ? v.toFixed(d) : '  -  ');
console.log(`engine=${engine} ${JSON.stringify(settings)}`);
console.log('case              Re      ms   conv    Clmax ref/calc    aClmax ref/calc  slope err%  RMS0-8  pass');
for (const c of cases) {
  const r = await runner.runPolar(seligText(c.id), { ...settings, re: c.re });
  const conv = r.points.filter((p) => p.converged);
  const calc = { alpha: conv.map((p) => p.alpha), cl: conv.map((p) => p.cl) };
  const m = compare(referencePolar(c.id, c.re), calc);
  const failedAlphas = r.points.filter((p) => !p.converged).map((p) => p.alpha);
  results.push({ ...c, name: section(c.id).name, ms: r.ms, nPoints: r.points.length, nConverged: conv.length, failedAlphas, metrics: m, points: r.points });
  const p = m.pass;
  console.log(
    `${c.id.padEnd(14)} ${String(c.re).padStart(7)} ${r.ms.toFixed(0).padStart(6)} ${String(conv.length).padStart(3)}/${r.points.length}`
    + `   ${f(m.clmaxRef)}/${f(m.clmaxCalc)}     ${f(m.aRef, 2)}/${f(m.aCalc, 2)}     ${f(m.slopeErrPct, 2).padStart(6)}   ${f(m.rms, 4)}  `
    + `${p.clmax ? 'C' : 'c'}${p.alpha ? 'A' : 'a'}${p.slope ? 'S' : 's'}${p.rms ? 'R' : 'r'}${m.allPass ? ' PASS' : ''}`,
  );
  if (failedAlphas.length) console.log(`    not converged: ${failedAlphas.join(' ')}`);
}
const mem = process.memoryUsage();
console.log(`rss ${(mem.rss / 1048576).toFixed(0)} MB, arrayBuffers ${(mem.arrayBuffers / 1048576).toFixed(0)} MB`);
if (opt('json')) fs.writeFileSync(opt('json'), JSON.stringify({ engine, settings, results }, null, 1));
