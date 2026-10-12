# Wingcalc

**Will it fly, how will it stall, and how many ribs does it need?**

Wingcalc is for the bit between "I fancy building a wing" and the first cut on the laser. Give it the all-up weight, draw the wing, pick an aerofoil, and it tells you whether you've designed a floater or a lawn dart, before the balsa finds out for you.

**[Open Wingcalc](https://canoemoose.github.io/Wingcalc/)**. It runs in your browser, nothing to install, no account.

## What it does

- **Cube loading first.** Wing loading flatters big models and slanders small ones. Cube loading doesn't, so that's the headline, with a plain verdict (glider, trainer, sport, scale, warbird, racer) and the stall speed beside it.
- **Stall character, not just stall speed.** Gentle, Moderate or Sharp, and *where* along the span it lets go first. A tip stall gets marked down, because that's the one that drops a wing at the bottom of a turn.
- **Real aerodynamics, quietly.** A lifting-line solution for the whole wing, and XFOIL itself (the original Fortran, compiled to WebAssembly) solving a fresh polar for your section at your Reynolds number, a second or two after you stop typing.
- **Any wing you can draw.** Straight, tapered, cranked, swept, elliptical, polyhedral, with washout and thickness taper, drawn in a CAD-style plan editor or typed in to the millimetre. Pick from all ~1,660 sections in the UIUC catalogue, or make your own.
- **Then it designs the structure.** Spar, covering and rib spacing checked against a design load, edge stock picked from what you can actually buy, and every rib, gusset, brace and web exported as DXF for a laser or router, or printed 1:1 to build over.

Metric or imperial, or both at once: type `24in + 50mm` into a millimetre box and it'll cope.

## Documentation

- [User guide](docs/user-guide.md): projects, the wing plan editor, the structure editor and export
- [Methods](docs/methods.md): the formulas, cube-loading bands, lifting line, XFOIL, stall character, structural loads and rib geometry
- [Aerofoil data](docs/aerofoil-data.md): what's bundled, where it comes from and how to refresh it

## Development

Vue 3 (plain JavaScript) and Vite. Node is pinned with Volta (see `package.json`).

```bash
npm install
npm run dev
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm test` | Unit tests (Vitest) |
| `npm run build` | Build the app into `dist/` (relative paths, host anywhere) |
| `npm run fetch-airfoils` | Refresh the bundled aerofoil data |

**Deploying:** the site is published to GitHub Pages by [a workflow](.github/workflows/pages.yml) that tests, builds and deploys. It runs when a version tag is pushed (`git tag v1.2.0`, then `git push origin v1.2.0`) or by hand from the Actions tab. Pushes to master don't deploy.

## Licence

Wingcalc is licensed under the GNU General Public License, version 3 or later ([LICENSE](LICENSE)). It includes XFOIL and WebXFOIL, both GPL version 2 or later; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Aerofoil coordinates are from the [UIUC Airfoil Coordinates Database](https://m-selig.ae.illinois.edu/ads/coord_database.html) and bundled polars from [airfoiltools.com](http://airfoiltools.com).
