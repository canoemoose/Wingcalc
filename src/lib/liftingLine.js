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
// tip, or null if it can't be solved. Also the response to extra twist at any one station,
// for holding stalled stations at their Clmax (progressiveStall): influence[i][j] is station
// i's cl per radian of washout added at station j alone, twistCL[j] the wing's CL per radian.
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
  // One unit-washout right-hand side per station, solved with the other two
  const unit = pts.map((_, j) => rhsA.map((v, m) => (m === j ? -v : 0)))
  const sol = solve(rows, [rhsA, rhsB, ...unit])
  if (!sol) return null
  const [A, B, ...U] = sol
  const ar = (span * span) / area
  const cl = (coef, th, c) => {
    if (!(c > 1e-9)) return 0
    let g = 0
    for (let k = 0; k < N; k++) g += coef[k] * Math.sin(ns[k] * th)
    return (4 * span * g) / c
  }
  // Root to tip: pts run tip to root
  const order = pts.map((_, i) => i).sort((a, b) => pts[a].eta - pts[b].eta)
  const stations = order.map((i) => {
    const p = pts[i]
    return { eta: p.eta, c: p.c, cla: cl(A, p.th, p.c), clb: cl(B, p.th, p.c) }
  })
  const influence = order.map((i) => order.map((j) => cl(U[j], pts[i].th, pts[i].c)))
  const twistCL = order.map((j) => Math.PI * ar * U[j][0])
  return { CLa: Math.PI * ar * A[0], CLb: Math.PI * ar * B[0], stations, aspectRatio: ar, influence, twistCL }
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

// The stall when some stations stall progressively (`progressive(eta)` true: those behind a
// deflected flap, where separation creeps forward from the flap rather than breaking at the
// nose). The stall still starts where the first station of all reaches its Clmax, but a
// progressive station that has stalled holds its Clmax (its excess is taken off as extra
// washout at that station, using the influence of each station's twist on the others) while
// the angle of attack goes on rising, until the first other station stalls or the angle is
// `maxPast` (radians) beyond the onset, whichever comes first. With no progressive station,
// or a first stall at an ordinary one, this is firstStall.
// Returns { CLmax, alpha, eta (where it starts), cl (each station's at CLmax) }.
export function progressiveStall(ll, clMax, progressive, maxPast) {
  const first = firstStall(ll, clMax)
  if (!first) return null
  const st = ll.stations
  const cm = st.map((s) => (s.cla > 1e-6 && s.c >= 1e-4 ? clMax(s.eta) : null))
  const prog = st.map((s) => !!progressive(s.eta))
  const ordinary = st.map((s, i) => cm[i] > 0 && !prog[i])
  const plain = () => ({ ...first, cl: st.map((s) => first.alpha * s.cla + s.clb) })
  const firstIndex = st.findIndex((s) => s.eta === first.eta)
  if (!prog[firstIndex] || !ordinary.some(Boolean)) return plain()

  const n = st.length
  const K = ll.influence
  // Each station's cl at root angle alpha, progressive stations held at their Clmax
  const at = (alpha) => {
    const t = new Array(n).fill(0)
    let cl = null
    for (let it = 0; it < 80; it++) {
      cl = st.map((s, i) => {
        let v = alpha * s.cla + s.clb
        for (let j = 0; j < n; j++) if (t[j]) v += K[i][j] * t[j]
        return v
      })
      let change = 0
      for (let i = 0; i < n; i++) {
        if (!prog[i] || !(cm[i] > 0) || !(K[i][i] < 0)) continue
        const next = Math.max(0, t[i] + (cl[i] - cm[i]) / -K[i][i])
        change = Math.max(change, Math.abs(next - t[i]))
        t[i] = next
      }
      if (change < 1e-7) break
    }
    let CL = alpha * ll.CLa + ll.CLb
    for (let j = 0; j < n; j++) CL += ll.twistCL[j] * t[j]
    return { cl, CL }
  }
  const margin = (r) => Math.min(...r.cl.map((v, i) => (ordinary[i] ? cm[i] - v : Infinity)))
  let alpha = first.alpha + maxPast
  if (margin(at(alpha)) < 0) {
    let lo = first.alpha
    let hi = alpha
    for (let k = 0; k < 30; k++) {
      const mid = (lo + hi) / 2
      if (margin(at(mid)) >= 0) lo = mid
      else hi = mid
    }
    alpha = lo
  }
  const r = at(alpha)
  return { CLmax: r.CL, alpha, eta: first.eta, cl: r.cl }
}
