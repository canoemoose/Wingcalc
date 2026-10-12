// Step 5 comparison metrics. Polars are { alpha:[], cl:[] } on any alpha grid;
// the computed polar holds converged points only.

function fit(alpha, cl, lo, hi) {
  const pts = alpha.map((a, i) => [a, cl[i]]).filter(([a]) => a >= lo - 1e-9 && a <= hi + 1e-9);
  const n = pts.length;
  if (n < 3) return NaN;
  const mx = pts.reduce((s, p) => s + p[0], 0) / n;
  const my = pts.reduce((s, p) => s + p[1], 0) / n;
  let sxy = 0, sxx = 0;
  for (const [x, y] of pts) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; }
  return sxy / sxx; // per degree
}

function peak(p) {
  let k = 0;
  for (let i = 1; i < p.cl.length; i++) if (p.cl[i] > p.cl[k]) k = i;
  return { clmax: p.cl[k], alpha: p.alpha[k] };
}

const key = (a) => a.toFixed(3);

export function compare(ref, calc) {
  const r = peak(ref), c = peak(calc);
  const sr = fit(ref.alpha, ref.cl, -2, 4), sc = fit(calc.alpha, calc.cl, -2, 4);
  const refMap = new Map(ref.alpha.map((a, i) => [key(a), ref.cl[i]]));
  let ss = 0, n = 0;
  calc.alpha.forEach((a, i) => {
    if (a < -1e-9 || a > 8 + 1e-9) return;
    const rv = refMap.get(key(a));
    if (rv === undefined) return;
    ss += (calc.cl[i] - rv) ** 2; n++;
  });
  const rms = n ? Math.sqrt(ss / n) : NaN;
  const m = {
    clmaxRef: r.clmax, clmaxCalc: c.clmax, dClmax: c.clmax - r.clmax,
    aRef: r.alpha, aCalc: c.alpha, dAlpha: c.alpha - r.alpha,
    slopeRef: sr, slopeCalc: sc, slopeErrPct: 100 * (sc - sr) / sr,
    rms, rmsN: n,
  };
  m.pass = {
    clmax: Math.abs(m.dClmax) <= 0.03,
    alpha: Math.abs(m.dAlpha) <= 0.5,
    slope: Math.abs(m.slopeErrPct) <= 3,
    rms: m.rms < 0.02,
  };
  m.allPass = Object.values(m.pass).every(Boolean);
  return m;
}

export function alphaGrid(start, end, step) {
  const out = [];
  for (let k = 0; ; k++) {
    const a = +(start + k * step).toFixed(6);
    if (a > end + 1e-9) break;
    out.push(a);
  }
  return out;
}
