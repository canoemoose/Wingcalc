// Ordinary least squares: rows are feature vectors, ys the targets. Returns coefficients,
// or null if the system is singular.
export function leastSquares(rows, ys) {
  const n = rows[0]?.length ?? 0
  if (!n || rows.length < n) return null
  const ata = Array.from({ length: n }, () => new Array(n).fill(0))
  const aty = new Array(n).fill(0)
  rows.forEach((r, k) => {
    for (let i = 0; i < n; i++) {
      aty[i] += r[i] * ys[k]
      for (let j = 0; j < n; j++) ata[i][j] += r[i] * r[j]
    }
  })
  for (let col = 0; col < n; col++) {
    let piv = col
    for (let r = col + 1; r < n; r++) if (Math.abs(ata[r][col]) > Math.abs(ata[piv][col])) piv = r
    ;[ata[col], ata[piv]] = [ata[piv], ata[col]]
    ;[aty[col], aty[piv]] = [aty[piv], aty[col]]
    if (Math.abs(ata[col][col]) < 1e-12) return null
    for (let r = col + 1; r < n; r++) {
      const f = ata[r][col] / ata[col][col]
      for (let c = col; c < n; c++) ata[r][c] -= f * ata[col][c]
      aty[r] -= f * aty[col]
    }
  }
  const x = new Array(n).fill(0)
  for (let r = n - 1; r >= 0; r--) {
    let s = aty[r]
    for (let c = r + 1; c < n; c++) s -= ata[r][c] * x[c]
    x[r] = s / ata[r][r]
  }
  return x
}
