# Trace image in the section editor

## Objective

Import a picture of a section (a scan, a photo of a plan, a screenshot) into the section editor and trace over it. The
image sits behind the grid and axes. Before it's placed, a dialogue crops and rotates it and takes the leading and
trailing edges, which put it on the drawing's chord.

## Decisions (agreed 2026-11-15)

- Autonomous mode.
- Alignment: drag LE and TE markers onto the image in the dialogue; the image is scaled, turned and moved so they
  land on the drawing's leading edge and trailing-edge midpoint as they are when the image is accepted. Rotate is
  there to level and crop comfortably; the markers set the final placement whatever the rotation.
- Session only: the image is not saved with the project. It stays while the app is open (across opening and closing
  the editor) until removed or replaced.

## Design

- Pure maths in `src/lib/traceImage.js`: rotated bounds, image to rotated-space mapping, level angle, crop clamp,
  placement from LE/TE onto a chord frame, the SVG matrix for the editor's view (including the 3x vertical), and moving
  the placement when the section is normalised.
- Session state in `src/composables/useTraceImage.js` (a module-level ref; object URLs revoked on replace and remove).
- Dialogue `src/components/TraceImport.vue`: stage with the rotated image, crop box (corners and edges), LE and TE
  markers, chord guide; quarter turns, a fine angle slider and box, Level chord; view controls as everywhere (left
  drags, right or middle pans, wheel and pinch zoom, − + Fit). Use image renders the rotated crop to a canvas
  (longest side capped) and hands back its URL and the markers in its pixels.
- `SectionEditor.vue`: `<image>` first in the SVG, under the grid; a Trace image… button in the command bar (with
  nothing selected) opening a popover: opacity, Adjust…, Replace…, Remove; an Image toggle top left while there's one.
  Normalise moves the image with the section.

## Steps

1. `traceImage.js` and its tests.
2. `useTraceImage.js`, `TraceImport.vue`, mount test.
3. Wire into `SectionEditor.vue`, styles.
4. User guide; run the app to catch crashes.

## Status

All four steps done (2026-11-15). Tests: `tests/traceImage.test.js` (the maths), two mounts in `tests/mount.test.js`
(the dialogue: marker drag, quarter turn, Level chord; the editor: image first in the SVG, Image toggle). Run in the
dev server with a generated picture: import, Use image, Adjust and Cancel, Normalise, no console errors. Used and
checked in the app by Matt.

## Known limits

- Undoing a Normalise doesn't move the image back (the image isn't in the undo history). Adjust… re-places it.
