// Stroke icons for the views' controls, as SVG path data on a 24 × 24 grid (drawn with
// fill none, stroke currentColor, round caps and joins). EYE, EYE_OFF and HOME are Tabler
// Icons (MIT, see THIRD_PARTY_NOTICES.md); the rest are drawn for Wingcalc.

export const EYE = ['M10 12a2 2 0 1 0 4 0a2 2 0 0 0 -4 0', 'M21 12c-2.4 4 -5.4 6 -9 6c-3.6 0 -6.6 -2 -9 -6c2.4 -4 5.4 -6 9 -6c3.6 0 6.6 2 9 6']
export const EYE_OFF = [
  'M10.585 10.587a2 2 0 0 0 2.829 2.828',
  'M16.681 16.673a8.717 8.717 0 0 1 -4.681 1.327c-3.6 0 -6.6 -2 -9 -6c1.272 -2.12 2.712 -3.678 4.32 -4.674m2.86 -1.146a9.055 9.055 0 0 1 1.82 -.18c3.6 0 6.6 2 9 6c-.666 1.11 -1.379 2.067 -2.138 2.87',
  'M3 3l18 18',
]
export const HOME = ['M5 12l-2 0l9 -9l9 9l-2 0', 'M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-7', 'M9 21v-6a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v6']

// A pointer arrow
export const SELECT = ['M6 3.5l12 8.5l-5.5 1.2l-2.7 5.3z', 'M12.5 13.2l4 5.3']
// A ruler laid diagonally, with ticks
export const MEASURE = ['M3.5 16l12.5 -12.5l4.5 4.5l-12.5 12.5z', 'M7.5 12l2 2', 'M10.5 9l1.5 1.5', 'M13.5 6l2 2']
// A wing panel (trapezoid) with a plus
export const ADD_PANEL = ['M3 6h7l3 12h-10z', 'M18 8v8', 'M14 12h8']
// Ribs with a plus
export const ADD_RIB = ['M5 5v14', 'M10 5v14', 'M3 5h9', 'M3 19h9', 'M18 9v6', 'M15 12h6']
// A grid, for snapping
export const SNAP = ['M4 9h16', 'M4 15h16', 'M9 4v16', 'M15 4v16']
// A cube in parallel projection: orthographic
export const ORTHO = ['M12 3l8 4.5v9l-8 4.5l-8 -4.5v-9z', 'M12 12l8 -4.5', 'M12 12v9', 'M12 12l-8 -4.5']
// A box whose far face is smaller: perspective
export const PERSPECTIVE = ['M3 9h11v11h-11z', 'M15 4h5v5h-5z', 'M3 9l12 -5', 'M14 9l6 -5', 'M14 20l6 -11']
// A blade across a bar: the section cut
export const CUT = ['M3 15h18', 'M3 9h18', 'M14 3l-4 18']
