// The Wingcalc mark: a sailplane seen from above, in white on the accent blue tile. Drawn
// chunky (broad chord, thick fuselage) so it holds at 16 px, and used at every size: the
// favicon, the app icons and the page header.
//
// SVG source text on a 32-unit grid, used by the header (WingCalc.vue) and by
// scripts/build-icons.mjs, which writes the files in public/.

export const LOGO_BLUE = '#1f6feb'
const WHITE = '#ffffff'

// The sailplane, nose up, centred across the tile: half span, root chord, tip chord,
// fuselage half-width at the wing, tailplane half span
const SPAN = 12.5
const CHORD = 4.2
const TIP = 2.4
const FUS = 1.8
const TAIL = 6

const fuselage =
  `M16 5.5C${16 + FUS} 5.5 ${16 + FUS} 7.5 ${16 + FUS} 9.5` +
  `L${16 + FUS * 0.55} 26.8H${16 - FUS * 0.55}L${16 - FUS} 9.5C${16 - FUS} 7.5 ${16 - FUS} 5.5 16 5.5Z`
// Leading edge straight across, trailing edge tapering to rounded tips
const wing =
  `M16 11.2L${16 + SPAN} 12.4C${16 + SPAN + 0.9} 12.6 ${16 + SPAN + 0.9} ${12.4 + TIP} ${16 + SPAN} ${12.4 + TIP}` +
  `L16 ${11.2 + CHORD}L${16 - SPAN} ${12.4 + TIP}C${16 - SPAN - 0.9} ${12.4 + TIP} ${16 - SPAN - 0.9} 12.6 ${16 - SPAN} 12.4Z`
const tailplane =
  `M16 24.2L${16 + TAIL} 25.1C${16 + TAIL + 0.6} 25.2 ${16 + TAIL + 0.6} 26.2 ${16 + TAIL} 26.3` +
  `L16 26.9L${16 - TAIL} 26.3C${16 - TAIL - 0.6} 26.2 ${16 - TAIL - 0.6} 25.2 ${16 - TAIL} 25.1Z`

// The icon at a given pixel size; rx is the corner radius in grid units (0 for a full-bleed
// square, which phones round themselves).
export function iconSvg(size, { rx = 7 } = {}) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32">` +
    `<rect width="32" height="32" rx="${rx}" fill="${LOGO_BLUE}"/>` +
    `<path d="${fuselage}${wing}${tailplane}" fill="${WHITE}"/></svg>`
  )
}
