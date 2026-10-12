# Wingcalc user guide

How to use the app. For how the numbers are worked out, see [Methods](methods.md).

## Entering values

Every input and output works in metric or imperial. The units menu at the top right sets the system and, within it, the unit for lengths (mm or m; in or ft), weights (g or kg; oz or lb) and speeds (km/h or m/s); areas and wing loading follow the length and weight units. The units are kept with the project. Numeric boxes accept sums (`700 - 20`, `(120 + 80) / 2`) and numbers with their own units (`24in + 50mm` in a millimetre box); commas are thousands separators. An unfinished sum leaves the last good value in place, and the result shows under the box while you type.

The wing is entered as fuselage width, root chord, then one or more panels per side, each with its own length, outer chord, sweep and dihedral, and straight edges, Bézier curves or chords dimensioned at stations, plus an optional rounded wingtip. For a quick check, mean chord or area can be entered instead.

The inputs column, the panel fields and the structure settings are foldable sections: click a heading to open or close it, and a closed section shows its key values on its heading line. Which sections are open is remembered in this browser, not in the project.

## Projects

The bar at the top holds the **File** menu, the project name, **Save** and undo/redo on the left, and the units and theme on the right.

- **Save** stores the project in this browser under its name; saving again updates it. A dot in the name box means there are unsaved changes.
- **File** holds **New project** (asking first if there are unsaved changes), **Save as copy**, the saved projects to open (newest first; delete one with its ×), and **Export to file** and **Import from file**.
- **Auto / Light / Dark** sets the colour theme. Auto follows the system setting. The choice is remembered in this browser; it isn't part of a project.
- The work in progress **autosaves** and comes back on reload, saved or not.
- **Export to file** downloads the project as a `.wingcalc.json` file; **Import from file** opens one. Use these to back up or move projects between browsers: saved projects belong to one browser on one machine and are lost if site data is cleared.

A project holds the units, weight, wing shape (including stations, tip, washout, thickness taper and dimensions), the aerofoil choice, the structure and the export options. Files from older versions open with anything missing filled from the defaults. If the browser blocks storage, saving is disabled with a note and Export still works.

## Wing plan editor

In "Chords & panels" mode the results column shows the wing plan: one half of the wing, drawn flat (as built), with the other half ghosted.

**Open wing editor** expands it to fill the browser window: the plan takes most of the space, the wing and panel settings sit on the left (tabs switch between panels), and a strip along the top keeps span, area, aspect ratio, cube loading and stall speed in view as you edit. Done or Esc returns to the page. The same values can be typed in the inputs column, which is the precise route; the plan updates as you type.

- **Select** a panel by clicking it (or its heading in the inputs column); the two stay in step, and selecting a panel opens its section.
- **Drag** the round handles at a panel's tip to change its length and sweep (leading edge) or its tip chord (trailing edge). Hold Shift to change length without changing sweep. The handle on the root trailing edge sets the root chord; the diamond ahead of the root sets the fuselage width.
- **Curves**: on the selected panel, drag the small dashed handle in the middle of either edge to curve it. That creates a square control handle; drag it to shape the curve, double-click it to straighten the edge again.
- **Chord stations**: set a panel's shape to "Chord stations" to define it by chords dimensioned along it. Each station has a distance from the panel's inner end, a chord, and a leading-edge set-back (how far its leading edge sits behind the panel's inner leading edge). Leave a set-back blank ("auto") and the station takes its leading edge from the line through its neighbours.
  - **Add station** under the table adds a blank row just above the tip, ready to type into; it's skipped until it has a distance and chord. **Add station** in the plan's command bar places one on the current shape in the middle of the largest gap, so the outline doesn't jump.
  - **The table** starts with the panel's inner end (greyed: its chord comes from the panel inboard) and ends with its tip, whose distance, chord and set-back are the panel's length, tip chord and sweep.
  - **Distances** are measured from the panel's inner end by default; switch to **Spacing** to enter each as the gap from the row above. In spacing mode, changing a gap moves everything outboard of it, tip included, like chained dimensions on a drawing.
  - **Typing**: Enter moves to the next box, like Tab (Shift+Enter goes back). A row being edited keeps its place until you leave it, then the table re-sorts by distance.
  - **Problems** don't stop the panel drawing. A station before the inner end, on or beyond the tip, or at the same place as another is skipped: its row says why, the warnings list names it, and the plan shows it as a dashed rib in the warning colour.
  - **Keep straight**: choose the leading edge, the trailing edge or a chord line (at a percentage you set; 25% for a straight quarter-chord line) to stay straight from end to end. Stations then set only their chord, and the edges sit either side of the straight line in proportion.
  - **Segments**: between the station rows, each segment shows whether it's curved or straight; click to switch. All straight gives a faceted outline, like straight sheeting between ribs. On the selected panel, drag a station's leading-edge handle to move it along the panel and set its set-back, and its trailing-edge handle to change its chord. Switching an existing panel to stations samples its current shape, so nothing changes until you edit.
- **Wingtip**: tick "Rounded tip" to add a rounded cap beyond the last panel. Drag its handle outward for the extension and along the chord for where it reaches furthest (0% rakes it back from the leading edge, 100% forward from the trailing edge).
- **Measure** (top left, or M; Esc or a second click stops): drag between two points to place a dimension. Ends snap to the wing's corners, stations, tip and root (a green ring shows the target) or to the grid otherwise; Alt ignores snapping. Ends snapped to the wing follow it as it changes. Hold Shift for a purely spanwise or chordwise dimension. Click a dimension and press Delete to remove it, or use **Clear dimensions**. Dimensions are saved with the project.
- **Snap** to the grid is on by default; the grid adapts to the zoom, and Alt disables snapping during a drag.
- **Navigate**: scroll to zoom about the pointer, drag empty space or a panel to pan; − + Fit sit in the bottom-right corner (F, + and − while the plan has focus). The view re-fits when the wing changes from outside the editor, but not during your own drags.
- **Keyboard** (with the plan focused): arrow keys move the selected panel's tip leading edge one grid step (left/right for length, up/down for sweep), Alt with up/down changes its tip chord, Delete removes the selected panel or dimension, M turns Measure on and off, Escape cancels, stops measuring or deselects.
- **Add panel** (in the bar along the top when nothing is selected) appends a new section at the tip, continuing the leading-edge line and dihedral of the last panel at about 40% of its length and 75% of its tip chord.
- **Insert after** (or + on a panel's fields) puts a new constant-chord panel just outboard of the selected one, so the panels further out keep their shape and the wing gets longer.
- **← / →** move the selected panel inward or outward. Each panel keeps its own shape; only the order changes.
- **Undo/Redo** (in the header, or Ctrl+Z / Ctrl+Y) covers the wing shape, the dimensions and the structure: each drag is one step, and typed changes are grouped once they pause. Opening a project starts a fresh history.

**Dihedral** can be entered per panel as an angle or as the **rise** of the panel's outer end above its inner end with the wing level (for a polyhedral tip panel, measured from the break). This isn't the "block the tip up X" figure on some plans, where the inner panel is pinned flat: for a tip panel that gives the angle relative to the inner panel, so add the inner panel's angle.

**Washout and thickness taper** are set per panel: washout is the total twist at a panel's outer end relative to the root (nose down), varying evenly across the panel; thickness is the section thickness at the outer end, blank to keep the inner end's. The section drawing shows the tip section dashed over the root.

## Aerofoils

Aerofoils are chosen from a catalogue of the whole UIUC Airfoil Coordinates Database in NACA, Eppler and Other tabs; 78 popular sections also have bundled polars. Multi-element sets (a slat, main element and flap together, such as 30P-30N) aren't listed, as nothing here can model them, but an element the database has as a file of its own is. A project saved with one before it was left out opens with a warning on the section drawing and the structure card, and no aerofoil figures, until another section is chosen. A **custom section** can be defined by its thickness and camber (each with its position) and its leading-edge radius, and is drawn to true proportion with its chord line, mean line and leading-edge circle so it can be checked by eye.

Results appear in two stages: instantly from the bundled polars or an estimate, then a second or two later from an XFOIL polar computed in the browser at the stall's own Reynolds number. The lift curve is drawn with the peak and the stall band marked, so the stall rating can be checked by eye. See [Methods](methods.md#polars-computed-in-the-browser-xfoil).

## Structure editor

In "Chords & panels" mode a **Structure and ribs** card sums up the built-up structure: small drawings of the plan and the wing in 3D, then the spar, covering, rib count and spacing, the lowest margin of safety at the design load, the root bending moment and an estimate of the bare structure's weight.

**Open structure editor** fills the window: settings on the left, and on the right, cards for the plan with every rib, a 3D view, the loads along the span and a preview of any part. The expand arrows on the Plan and 3D cards grow that card to most of the window's height, and back. **Export…** at the right of the top strip opens the export options.

### What you set

- **Design loads**: load factor (6 g sport, 10 g or more for aerobatics or hard launches), a negative load factor, and a safety factor (1.5 by default) applied on top.
- **Spar**: caps and shear web (one web, flush with the caps' front face), box (two webs, flush with both faces), carbon tube, or a single solid spar (through a slot, or notched into the top or bottom of each rib). Its position is a chord fraction held at every panel end and straight across each panel; blank puts it at the section's thickest point. A tube can stop short of the tip.
- **Covering**: open (film covered, optional cap strips on each rib), D-box (sheeted from the leading edge back to the spar, cap strips behind it) or fully sheeted. The ribs are inset by whatever covers them.
- **Leading and trailing edges**: stock from SLEC's standard range, picked automatically to fit the section or chosen by hand, or a custom size. The ribs are cut back by its depth. A warning says if the chosen stock is too small for the section.
- **Stringers**: any number, by chord position, on the top, bottom or both surfaces. Each is notched into every rib and counted in bending; a top stringer just behind the leading edge doubles as a turbulator spar.
- **Ribs**: material and thickness; streamwise or square to the spar (the root, panel-break and tip ribs always stay streamwise so the panels and fuselage meet cleanly); one-piece wing (a centre rib shared by both halves) or two halves plugging in at the fuselage side. Optional **lightening holes** (not in the root, break or tip ribs) and **jig tabs**.
- **Rib spacing**: **from loads** (as close as the structure needs, never wider than a maximum set for the covering), **even**, **tapered** from root to tip, or **manual**. **Hard points** add ribs at set distances (servo bays, aileron ends). Switching to manual starts from the ribs as they are; then double-click the wing to add a rib there, or use **Add rib** in the bar along the top (or A) to add one mid-way along the longest bay; drag a rib or hard point along the span (it snaps to the grid; Alt places it freely), Delete removes the selected one and the arrow keys nudge it (Shift for ten steps). The root, panel-break and tip ribs are fixed.
- **Corner gussets** where ribs meet the leading or trailing edge, on the root, break and tip ribs or on every rib, one side or both, flush with the rib's top edge, bottom edge, or both, chosen separately for each edge. Each is cut to the actual angle between rib and edge. A placement there isn't depth for between the skins is turned off (top and bottom needs twice the gusset's thickness, which a thin trailing edge seldom has), and gussets that don't fit at all are listed in the warnings.
- **Dihedral braces**: ply plates on both faces of the spar at every dihedral break, shaped to the dihedral angle with the break engraved on. Left blank, the thickness is the next standard ply thickness above what the bending at the break needs.
- **Materials**: three grades of balsa, spruce, basswood, birch and lite ply, pultruded carbon strip and carbon tube. Balsa varies two to three times from sheet to sheet, so weigh your wood and pick the grade it matches.

### Reading the results

The plan shades bays amber where ribs are too far apart and red where the spar, web or sheeting is short of strength in itself; closer ribs only fix the first. A warning says which part, where, by how much and what would help, including roughly the cap thickness needed. Sheeted areas are hatched.

The **3D** view shows the built-up half wing, built from the same geometry as the cut parts: see-through covering, sheeting and cap strips, ribs, gussets and braces, a rounded tip's block, spar, shear webs, edge stock and stringers, with twist and dihedral true to scale.

- Drag to turn, right-drag to move, scroll to zoom; − + Fit in the bottom-right corner.
- Click the view cube (Top, Bottom, Front, Back, Root, Tip) to swing round to that view. The house beside it goes back to the starting angle, and the button under it switches between orthographic (the default, which makes the cube's views true elevations) and perspective.
- **Layers** (top left): show **Both halves** for the whole wing, hide layers to see inside, and turn **Outlines** (the sharp edges of every part) on or off. Click a rib to select it.
- **Section** cuts the wing square to the span: everything outboard is hidden and the cut face is filled, coloured by part. A bar along the bottom places the cut: drag along it (the ticks are the ribs; the cut is kept off the ribs themselves), and it shows the distance from the root rib and the bay. **Flip** keeps the outboard part instead, **Look at cut** swings round to face it, and × closes the section.

## Export

**Export…** in the structure editor offers four downloads:

- **Parts (DXF)**: every part laid out flat in rows no longer than the sheet length you set, grouped by stock (material and thickness), each group titled. Grain runs left to right along the sheet; shear webs are turned so theirs runs up the web. One copy per piece needed, or one of each.
- **Plan (DXF)**: full size, to build over: the wing outline, edge stock, spar, stringers and every rib at its true thickness, with rib names and the sheeted areas hatched. Right half, left half (mirrored) or both.
- **Cut list (CSV)**: every part with quantity, stock and size, and every length of strip, with how many lengths of edge stock to buy.
- **Printed templates (PDF, 1:1)**: the parts (true size, no kerf allowance) or the plan, to build over or cut round by hand. On A4, A3, Letter or Tabloid the drawing is split across as few sheets as possible, overlapping by 10 mm, each named (A1, A2 …, rows down the drawing) with its neighbours marked on its edges. Or one sheet sized to the drawing, for a plotter or print shop. Every sheet has a title block and a 50 mm bar to check it printed at 100%.

The DXF is AutoCAD R12 in millimetres, which nearly all laser, router and CAD software reads, as closed polylines or (for older software) separate lines. Layers are cut (red), engrave (blue) and notes (grey), with names you can change. Labels are single-stroke vector lines in a Hershey font, so they engrave the same in any software. A part too small to carry a label at least 2 mm high (a corner gusset, say) has it engraved on the sheet just below it instead, so you can tell the pieces apart as you pick them out.

Lightening holes and jig tabs change the parts themselves, so they're set in the structure editor under **Ribs**; the export dialogue only says which are on.

- **Laser**: every cut moves half the kerf into the waste, so parts come out true size (set the kerf to 0 if your laser software compensates).
- **CNC router**: dogbones in every inside corner, and optionally the cutter-radius offset if your CAM doesn't apply it. Corners too tight for the cutter are listed.

Export options are saved with the project, so a re-export comes out the same.
