// Aerofoil family from a UIUC / airfoiltools id (e.g. "naca2412", "n0012-il", "e205").
export function familyOf(id) {
  const base = id.toLowerCase().replace(/-il$/, '')
  if (/^(n|naca)\d/.test(base)) return 'naca'
  if (/^e\d/.test(base)) return 'eppler'
  return 'other'
}

// UIUC file stem for an airfoiltools id ("naca2412-il" -> "naca2412").
export function uiucId(id) {
  return id.toLowerCase().replace(/-il$/, '')
}
