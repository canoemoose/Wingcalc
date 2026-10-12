// Prandtl lifting-line theory, solved by Glauert's Fourier series for a symmetric wing.
//
// Spanwise position y = (b/2) cos θ, so θ = π/2 at the root and 0 at the tip. The
// circulation is Γ(θ) = 2 b V Σ Aₙ sin nθ over odd n (symmetric loading), and at each
// collocation angle θₘ (between root and tip):
//
//   Σ Aₙ sin nθₘ (n μₘ + sin θₘ) = μₘ αₘ sin θₘ,    μ = c a₀ / (4 b)
//
// where α is the local angle of attack from zero lift, c the chord and a₀ the section
// lift-curve slope (per radian). Then the local lift coefficient is
// cl = (4 b / c) Σ Aₙ sin nθ and the wing's CL = π AR A₁.
//
// The equations are linear in α, so the solution is split in two: a "basic" part for unit
// angle of attack everywhere, and a "twist" part for the washout alone. Any condition is
// then cl(y) = α_root · cl_a(y) + cl_b(y), which makes finding the stall a one-line search.
//
// The model ignores sweep (applied afterwards as the usual cos Λ correction) and treats
// dihedral as a flat wing of the projected span, consistent with the projected area used
// for stall speed.

// Gaussian elimination with partial pivoting, for one matrix and several right-hand sides.
function solve(a, rhs) {
  const n = a.length
  const m = a.map((row) => [...row])
  const b = rhs.map((col) => [...col])
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r
    ;[m[c], m[p]] = [m[p], m[c]]
    for (const col of b) [col[c], col[p]] = [col[p], col[c]]
    const d = m[c][c]
    if (Math.abs(d) < 1e-15) return null
    for (let r = c + 1; r < n; r++) {
      const f = m[r][c] / d
      if (!f) continue
      for (let k = c; k < n; k++) m[r][k] -= f * m[c][k]
      for (const col of b) col[r] -= f * col[c]
    }
  }
  return b.map((col) => {
    const x = new Array(n).fill(0)
    for (let r = n - 1; r >= 0; r--) {
      let s = col[r]
      for (let k = r + 1; k < n; k++) s -= m[r][k] * x[k]
      x[r] = s / m[r][r]
    }
    return x
  })
}

// Solve the lifting line for a half-wing described by station(eta) at eta = y / (b/2), from
// 0 (root) to 1 (tip): { c, twist (radians, + washout), a0 (per radian) }.
// span is the full projected span b (m), area the projected wing area S (m²).
// Returns { CLa, CLb, stations: [{ eta, c, cla, clb }] } with the stations running root to
// tip, or null if it can't be solved.
export function liftingLine({ span, area, station, terms = 24 }) {
  if (!(span > 0) || !(area > 0)) return null
  const N = terms
  const ns = Array.from({ length: N }, (_, k) => 2 * k + 1)
  const rows = []
  const rhsA = []
  const rhsB = []
  const pts = []
  for (let m = 1; m <= N; m++) {
    const th = (m * Math.PI) / (2 * N) // (0, π/2]: tip side to root
    const eta = Math.cos(th)
    const st = station(eta)
    if (!st || !(st.c >= 0) || !(st.a0 > 0)) return null
    const mu = (st.c * st.a0) / (4 * span)
    const s = Math.sin(th)
    rows.push(ns.map((n) => Math.sin(n * th) * (n * mu + s)))
    rhsA.push(mu * s)
    rhsB.push(-mu * (st.twist || 0) * s)
    pts.push({ th, eta, c: st.c })
  }
  const sol = solve(rows, [rhsA, rhsB])
  if (!sol) return null
  const [A, B] = sol
  const ar = (span * span) / area
  const cl = (coef, th, c) => {
    if (!(c > 1e-9)) return 0
    let g = 0
    for (let k = 0; k < N; k++) g += coef[k] * Math.sin(ns[k] * th)
    return (4 * span * g) / c
  }
  const stations = pts
    .map((p) => ({ eta: p.eta, c: p.c, cla: cl(A, p.th, p.c), clb: cl(B, p.th, p.c) }))
    .sort((a, b) => a.eta - b.eta)
  return { CLa: Math.PI * ar * A[0], CLb: Math.PI * ar * B[0], stations, aspectRatio: ar }
}

// The root angle of attack (from zero lift, radians) giving a wing lift coefficient CL.
export function alphaForCL(ll, CL) {
  return (CL - ll.CLb) / ll.CLa
}

// Local lift coefficients at each station for a wing lift coefficient CL.
export function clDistribution(ll, CL) {
  const a = alphaForCL(ll, CL)
  return ll.stations.map((s) => ({ ...s, cl: a * s.cla + s.clb }))
}

// The stall: the wing CL at which the first station reaches its own section Clmax, and
// where that happens. clMax(eta) gives each station's section Clmax. Stations with
// (nearly) no chord at the very tip are skipped: they carry no lift to speak of, and their
// local cl is ill-conditioned.
export function firstStall(ll, clMax) {
  let best = null
  for (const s of ll.stations) {
    if (!(s.cla > 1e-6) || s.c < 1e-4) continue
    const cm = clMax(s.eta)
    if (!(cm > 0)) continue
    const a = (cm - s.clb) / s.cla
    if (!best || a < best.alpha) best = { alpha: a, eta: s.eta }
  }
  if (!best) return null
  return { CLmax: best.alpha * ll.CLa + ll.CLb, alpha: best.alpha, eta: best.eta }
}
