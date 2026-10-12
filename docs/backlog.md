# Backlog

Open questions and notes that don't belong in the public docs.

## Bundled polar data licence

airfoiltools.com publishes no terms of use: a privacy policy and a footer reading "Copyright © 2026 All Rights Reserved", but no licence for reuse. The polars in `src/data/airfoils.json` are its own XFOIL output and presumably fall under that notice. The UIUC Airfoil Coordinates Database is publicly available, but neither its database page nor its home page states terms or a licence.

The app is now public on GitHub Pages. Options:

- Ask airfoiltools.com (via its contact page) for permission to redistribute the polars.
- Regenerate the bundled polars ourselves with the same WebXFOIL build the app runs, from the UIUC coordinates. Removes the airfoiltools question; UIUC remains.

Background on where the bundled and computed polars differ: `docs/scope-xfoil-wasm.md`.

## Element files of multi-element sets aren't normalised

Multi-element sets are left out of the picker (see `docs/aerofoil-data.md`), but the database also has some of their elements as separate files: `30p-30n-main`, `30p-30n-flap`, `r1145msm`, `r1145msf`, `ua79sfm`, `ua79sff`. These keep the coordinates of the assembled set, so their x extent is 0.26 to 0.83 rather than 1, and some start well aft of 0. `splitSurfaces` shifts the nose to 0 but doesn't scale, so a flap element is drawn and built at about a quarter of the chord set in the plan, and its catalogue thickness and camber are fractions of the set's chord, not its own. `e664ex` (extended E664, x to 1.2) has the same issue the other way. Normalising to unit chord (in the fetch script, and recomputing the stats) would fix all of them; they are rare enough to leave for now.
