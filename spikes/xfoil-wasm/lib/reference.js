// Reference polars bundled with Wingcalc (airfoiltools.com, XFOIL, Ncrit 9).
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const dataPath = fileURLToPath(new URL('../../../src/data/airfoils.json', import.meta.url));
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const sections = Array.isArray(data.sections) ? data.sections : Object.values(data.sections);

export const CASES = [
  { id: 'naca2412-il', re: [200000, 100000, 500000] },
  { id: 'n0012-il', re: [100000, 500000] },
  { id: 'e205-il', re: [100000, 500000] },
  { id: 'clarky-il', re: [100000, 500000] },
  { id: 'sd7037-il', re: [100000, 500000] },
  { id: 's1223-il', re: [100000, 500000] },
];

export function section(id) {
  const s = sections.find((x) => x.id === id);
  if (!s) throw new Error(`No section ${id}`);
  return s;
}

export function referencePolar(id, re) {
  const p = section(id).polars.find((x) => x.re === re);
  if (!p) throw new Error(`No ${re} polar for ${id}`);
  return { alpha: p.alpha, cl: p.cl };
}

export function seligText(id) {
  const s = section(id);
  return `${s.name}\n${s.coords.map(([x, y]) => `${x.toFixed(6)} ${y.toFixed(6)}`).join('\n')}\n`;
}
