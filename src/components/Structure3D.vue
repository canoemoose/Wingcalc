<script setup>
// The built-up half wing in 3D: see-through covering, sheeting and cap strips, ribs at their
// thickness, spar, webs, edge stock and stringers. Drag to orbit, right-drag or Shift-drag to
// pan, scroll to zoom; click a part to select it (shared with the plan and the part preview):
// a rib, gusset, web, brace, plate, sheet and so on, whatever the parts list has. Spars, edge
// stock, stringers and the like are strip stock, not parts, and select nothing.
//
// Top right, a view cube with labelled faces: click a face to swing round to that view.
//
// Section: cuts the wing square to the span, hides everything outboard of the cut and fills
// the cut face, coloured by part. Placed with a bar along the bottom of the view: a track the
// length of the span with a tick at each rib (the cut is kept off the ribs themselves).
//
// three.js loads on first use, so it costs nothing until the view is opened. It renders on
// demand, not in a loop; the only animation is swinging the camera to a chosen view.
//
// Orthographic (the default) or perspective: orthographic makes the cube's views true
// elevations (ribs in line, dihedral and washout at their real angles). Switching keeps the
// same viewpoint and the same framing at the point being looked at.
//
// Outlines: the sharp edges of every solid (not the covering), drawn as lines.
//
// A foam wing has no ribs: its core is a solid between the skins (its own layer), each control
// surface's core with the surface.
import { ref, watch, onMounted, onBeforeUnmount, computed } from 'vue'
import { wing3d, sectionAt, spanPlane, worldPoint, HOME_VIEW, faceView, orbitLerp, partFor, spanOf } from '../lib/wing3d.js'
import { format, defaultUnit } from '../lib/units.js'
import { EYE, EYE_OFF, HOME, ORTHO, PERSPECTIVE, CUT } from '../lib/icons.js'
import StageZoom from './StageZoom.vue'

const props = defineProps({
  analysis: { type: Object, required: true },
  structure: { type: Object, required: true },
  parts: { type: Array, required: true },
  selected: { type: String, default: null },
  system: { type: [String, Object], default: 'metric' }, // a units setting (units.js normaliseUnits) or system name
})
const emit = defineEmits(['select'])

const wrapEl = ref(null)
const status = ref('Loading the 3D view…')
// The covering (film, tissue, cloth) is never drawn: a skin that thin over thicker parts
// renders badly, and the structure is what the view is for. Sheeting is structure, so it is.
const show = ref({ core: true, sheeting: true, capStrips: true, ribs: true, surfaces: true, hinges: true, gussets: true, braces: true, spar: true, edges: true, tip: true, stringers: true, servos: true, servoPlates: true, brakes: true, outlines: true, mirror: false })
const LAYERS = [
  { id: 'core', label: 'Foam core' },
  { id: 'sheeting', label: 'Sheeting' },
  { id: 'capStrips', label: 'Cap strips' },
  { id: 'ribs', label: 'Ribs' },
  { id: 'surfaces', label: 'Control surfaces' },
  { id: 'hinges', label: 'Hinge spars' },
  { id: 'servos', label: 'Servos' },
  { id: 'servoPlates', label: 'Servo plates' },
  { id: 'brakes', label: 'Air brakes' },
  { id: 'gussets', label: 'Gussets' },
  { id: 'braces', label: 'Dihedral braces' },
  { id: 'spar', label: 'Spar and webs' },
  { id: 'edges', label: 'Leading/Trailing edges' },
  { id: 'tip', label: 'Tip block' },
  { id: 'stringers', label: 'Stringers' },
  { id: 'outlines', label: 'Outlines' },
  { id: 'mirror', label: 'Both halves' },
]
// The Layers menu (after Screenvision's): open until its button, Esc or a press elsewhere closes it
const menu = ref(null) // 'layers' | null
const toggleMenu = (m) => (menu.value = menu.value === m ? null : m)
const menuEl = ref(null)
function closeMenuIfOutside(target) {
  if (menu.value && target && !menuEl.value?.contains(target)) menu.value = null
}
function onMenuPointer(e) {
  closeMenuIfOutside(e.target)
}
function onMenuFocusOut(e) {
  closeMenuIfOutside(e.relatedTarget)
}
watch(menu, (m) => {
  if (typeof document === 'undefined') return
  if (m) document.addEventListener('pointerdown', onMenuPointer, true)
  else document.removeEventListener('pointerdown', onMenuPointer, true)
})
function onKeydown(e) {
  if (e.key === 'Escape' && menu.value) menu.value = null
}
// Shortcuts while the view has focus (a click in it gives it focus), as in the plans:
// F fits, + and − zoom. Not while typing in one of its menus' fields.
function onViewKey(e) {
  if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest('input, select, textarea')) return
  if (e.key === 'f' || e.key === 'F') fitView()
  else if (e.key === '+' || e.key === '=') zoomBy(1.25)
  else if (e.key === '-' || e.key === '_') zoomBy(1 / 1.25)
  else return
  e.preventDefault()
}
function focusView(e) {
  if (!e.target.closest('button, input, select, label')) wrapEl.value?.focus({ preventScroll: true })
}
// The wheel zooms this view only while focus is inside it; otherwise the page scrolls.
// OrbitControls ignores the wheel (and doesn't preventDefault) when enableZoom is off.
function onZoomFocus(e) {
  const inside = e.type === 'focusin' || wrapEl.value?.contains(e.relatedTarget)
  if (controls) controls.enableZoom = !!inside
}
const foam = computed(() => props.structure.construction === 'foam')
// A foam wing's sheeting is its skins
const layerLabel = (l) => (l.id === 'sheeting' && foam.value ? 'Skins' : l.label)
// Only the layers this wing has: a group with something in it once the model is built (a foam
// wing has no ribs or gussets, an open one no sheeting, and so on)
const present = ref({})
const shown = (l) => l.id === 'outlines' || l.id === 'mirror' || !!present.value[l.id]

// Section
const ribs = computed(() => props.parts.filter((p) => p.group === 'ribs').sort((p, q) => p.s - q.s))
const bays = computed(() =>
  ribs.value.slice(1).map((r, i) => ({ value: i, label: `${ribs.value[i].name}–${r.name}`, s: (ribs.value[i].s + r.s) / 2 })),
)
const section = ref({ on: false, s: 0, flip: false }) // flip keeps the outboard part instead
// The bay the cut is in
const bay = computed(() => {
  const s = section.value.s
  const i = ribs.value.findIndex((r, k) => k > 0 && s <= r.s)
  return Math.max(0, i - 1)
})
const sectionRange = computed(() => ({ min: props.analysis.rootS, max: props.analysis.tipS }))
const sectionLabel = computed(() => {
  const d = format(section.value.s - props.analysis.rootS, 'length', defaultUnit(props.system, 'length'))
  const b = bays.value[bay.value]
  return b ? `${d}, ${b.label}` : d
})
// Each rib's place along the track, 0 to 1
// A tick at each rib along the section bar, each named as on the plan unless its name would
// overlap one already placed. The two ribs either side of the cut are placed first, then the
// first and last, then the rest root outward.
const trackEl = ref(null)
const trackWidth = ref(0)
let trackObs = null
watch(trackEl, (el) => {
  trackObs?.disconnect()
  trackObs = null
  if (!el || typeof ResizeObserver === 'undefined') return
  trackObs = new ResizeObserver(() => (trackWidth.value = el.clientWidth))
  trackObs.observe(el)
  trackWidth.value = el.clientWidth
})
// A name's width in px at the label's size (0.68rem, digits and capitals about 0.6 em each)
const labelWidth = (name) => name.length * 6.6 + 2
const ribTicks = computed(() => {
  const { min, max } = sectionRange.value
  const list = ribs.value
  const k = list.findIndex((r) => r.s > section.value.s)
  const bay = k > 0 ? [k - 1, k] : []
  const ticks = list.map((r, i) => ({ id: r.id, name: r.name, at: (r.s - min) / Math.max(1e-9, max - min), named: false, near: bay.includes(i) }))
  const W = trackWidth.value
  if (!(W > 0)) {
    ticks.forEach((t) => (t.named = true))
    return ticks
  }
  const taken = []
  const order = [...bay, 0, ticks.length - 1, ...ticks.keys()]
  for (const i of order) {
    const t = ticks[i]
    if (!t || t.named) continue
    const half = labelWidth(t.name) / 2 + 2
    const x = t.at * W
    if (taken.some(([a, b]) => x - half < b && x + half > a)) continue
    taken.push([x - half, x + half])
    t.named = true
  }
  return ticks
})
// Move the cut along the span, kept clear of the ribs: a cut through a rib shows nothing
// useful, so a value inside one moves to the side it came from
function moveCut(s) {
  const prev = section.value.s
  for (const r of ribs.value) {
    const half = r.thickness / 2 + 0.0008
    if (Math.abs(s - r.s) < half) s = prev < r.s ? r.s - half : r.s + half
  }
  const { min, max } = sectionRange.value
  section.value = { ...section.value, s: Math.min(max, Math.max(min, s)) }
}
function chooseBay(i) {
  const b = bays.value[i]
  if (b) section.value = { ...section.value, s: b.s }
}
function toggleSection(on) {
  let flip = section.value.flip
  if (on) {
    // Start in the bay outboard of the selected rib, if there is one
    const k = ribs.value.findIndex((r) => r.id === props.selected)
    chooseBay(Math.min(Math.max(0, k), bays.value.length - 1))
    // Keep the part whose cut face is towards the camera: from inboard (as the home view),
    // the outboard part
    if (camera) {
      const { point, normal } = spanPlane(props.analysis, section.value.s)
      const off = camera.position.toArray().map((v, i) => v - point[i])
      flip = off[0] * normal[0] + off[1] * normal[1] + off[2] * normal[2] < 0
    }
  }
  section.value = { ...section.value, on, flip }
}

let THREE = null
let toCreasedNormals = null
let renderer = null
let scene = null
let camera = null // whichever of the two is in use
let perspCam = null
let orthoCam = null
const projection = ref('orthographic') // 'orthographic' | 'perspective'
const projectionText = computed(() =>
  projection.value === 'orthographic'
    ? { label: 'Orthographic: switch to perspective', title: "Orthographic: true elevations from the cube's faces. Click for perspective." }
    : { label: 'Perspective: switch to orthographic', title: 'Perspective. Click for orthographic.' },
)
const FOV = 35
let controls = null
let root = null // this half
let mirror = null // the other half
let cut = null // the section's filled face
let clip = null // the section's clipping plane
let resizeObs = null
let framed = false
const cube = { scene: null, camera: null, mesh: null, size: 96, margin: 8 }

const COLOURS = {
  rib: 0xd9b77e,
  spar: 0xb98a4e,
  web: 0xe6cf9f,
  le: 0xe3c48f,
  te: 0xe3c48f,
  stringer: 0xc9a46a,
  tube: 0x2f3337,
  sheet: 0xecd9b0,
  gusset: 0xe8cc94,
  tip: 0xeedcb4,
  brace: 0xa8794a,
  hinge: 0xc49a5e,
  hingeMoving: 0xd1a868,
  servo: 0x3a3f45,
  servoOutput: 0xf2f2ee,
  servoLead: 0xd9a400,
  brakeBox: 0xc9a46a,
  blade: 0x7f8c97,
  plate: 0xa8794a,
  teMoving: 0xe3c48f,
  tab: 0x8fa3ad,
  core: 0xe9e5d8,
  coreMoving: 0xe9e5d8,
}
// Each moving surface (its ribs, hinge spar and trailing edge) is one layer, so it can be
// hidden to see the fixed part's hinge spar
const GROUPS = ['core', 'sheeting', 'capStrips', 'ribs', 'surfaces', 'hinges', 'servos', 'servoPlates', 'brakes', 'gussets', 'braces', 'spar', 'edges', 'tip', 'stringers']
const OUTLINE_ANGLE = 30 // degrees between faces for an edge to be drawn

function cssColour(name, fallback) {
  const v = wrapEl.value ? getComputedStyle(wrapEl.value).getPropertyValue(name).trim() : ''
  return v || fallback
}

function canvasSize() {
  const el = wrapEl.value
  return { w: el?.clientWidth || 640, h: el?.clientHeight || 400 }
}

function render() {
  if (!renderer || !scene || !camera) return
  const { w, h } = canvasSize()
  renderer.setViewport(0, 0, w, h)
  renderer.clear()
  renderer.render(scene, camera)
  if (cube.scene) renderCube(w, h)
}

// The menus drop down inside the view, so they're capped to its height (and scroll)
const stageH = ref(400)
const menuMax = computed(() => `${Math.max(120, stageH.value - 56)}px`)

function size() {
  const { w, h } = canvasSize()
  stageH.value = h
  renderer.setSize(w, h, false)
  perspCam.aspect = w / h
  perspCam.updateProjectionMatrix()
  const half = (orthoCam.top - orthoCam.bottom) / 2
  orthoCam.left = (-half * w) / h
  orthoCam.right = (half * w) / h
  orthoCam.updateProjectionMatrix()
  // Still as framed: frame again for the new size (the first layout, a card growing).
  // Otherwise keep the scale, so a taller view shows more round the wing rather than
  // magnifying it.
  if (autoFramed && bounds) {
    const dir = camera.position.clone().sub(controls.target)
    frame(shownBounds(), [dir.x, dir.y, dir.z])
  } else if (lastH && h !== lastH && controls) {
    swinging++
    orthoCam.zoom *= lastH / h
    orthoCam.updateProjectionMatrix()
    camera.position.sub(controls.target).multiplyScalar(camera === perspCam ? h / lastH : 1).add(controls.target)
    controls.update()
  }
  lastH = h
  render()
}
let lastH = 0

// Half the height the perspective camera sees at the point it's looking at.
const viewHalfHeight = (cam) => cam.position.distanceTo(controls.target) * Math.tan(((FOV / 2) * Math.PI) / 180)

// Switch projection, keeping the viewpoint and what's framed at the target.
function setProjection(kind) {
  if (!THREE || (kind === 'orthographic') === (camera === orthoCam)) return
  const { w, h } = canvasSize()
  if (kind === 'orthographic') {
    const half = viewHalfHeight(perspCam)
    Object.assign(orthoCam, { left: (-half * w) / h, right: (half * w) / h, top: half, bottom: -half, zoom: 1 })
    orthoCam.position.copy(perspCam.position)
    orthoCam.quaternion.copy(perspCam.quaternion)
    orthoCam.up.copy(perspCam.up)
    orthoCam.updateProjectionMatrix()
    camera = orthoCam
  } else {
    // Back to perspective at the distance that frames what the orthographic view showed
    const half = (orthoCam.top - orthoCam.bottom) / 2 / orthoCam.zoom
    const dist = half / Math.tan(((FOV / 2) * Math.PI) / 180)
    const dir = orthoCam.position.clone().sub(controls.target).normalize()
    perspCam.position.copy(controls.target).add(dir.multiplyScalar(dist))
    perspCam.quaternion.copy(orthoCam.quaternion)
    perspCam.up.copy(orthoCam.up)
    perspCam.updateProjectionMatrix()
    camera = perspCam
  }
  controls.object = camera
  controls.update()
  render()
}

function disposeGroup(g) {
  g?.traverse((o) => {
    o.geometry?.dispose()
    if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose())
    else {
      o.material?.map?.dispose()
      o.material?.dispose()
    }
  })
}

// Smooth shading across gentle curves, sharp at corners (the end faces, a box's edges), so
// solids don't look blurred at their edges. The skin stays smooth all over.
function meshFrom(data, material, { creased = true } = {}) {
  let geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3))
  geo.setIndex(new THREE.BufferAttribute(data.indices, 1))
  if (creased && toCreasedNormals) geo = toCreasedNormals(geo, Math.PI / 6)
  else geo.computeVertexNormals()
  return new THREE.Mesh(geo, material)
}

function build() {
  // Not before the scene exists: three.js may already be loaded (by an earlier view) when a prop
  // changes while this one is still mounting
  if (!THREE || !scene) return
  const model = wing3d(props.analysis, props.structure, props.parts)
  if (root) {
    scene.remove(root)
    scene.remove(mirror)
    disposeGroup(root)
  }
  root = new THREE.Group()
  // Every solid's sharp edges, as lines that hide with it (and with Outlines off)
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x5b4a32, transparent: true, opacity: 0.55 })
  const outlined = (mesh) => {
    const lines = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, OUTLINE_ANGLE), edgeMat)
    lines.userData.outline = true
    lines.raycast = () => {} // clicks go to the solid, not its outline
    mesh.add(lines)
    return mesh
  }
  const groups = {}
  for (const id of GROUPS) {
    groups[id] = new THREE.Group()
    groups[id].name = id
    root.add(groups[id])
  }
  const wood = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, metalness: 0, side: THREE.DoubleSide })
  // Ribs and webs share faces with the caps, stringers and edge stock that pass through or
  // butt against them; pushing them a hair back in depth stops the shared faces flickering.
  const behind = (c) => Object.assign(wood(c), { polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 })
  const tube = props.structure.spar.type === 'tube'
  for (const s of model.solids) {
    const colour = s.kind === 'spar' && tube ? COLOURS.tube : COLOURS[s.kind]
    const group =
      s.kind === 'hingeMoving' || s.kind === 'teMoving' || s.kind === 'coreMoving'
        ? groups.surfaces
        : s.kind === 'core'
        ? groups.core
        : s.kind === 'servo' || s.kind === 'servoOutput' || s.kind === 'servoLead'
        ? groups.servos
        : s.kind === 'plate'
        ? groups.servoPlates
        : s.kind === 'brakeBox' || s.kind === 'blade'
        ? groups.brakes
        : s.kind === 'hinge' || s.kind === 'tab'
        ? groups.hinges
        : s.kind === 'spar' || s.kind === 'web'
        ? groups.spar
        : s.kind === 'stringer'
          ? groups.stringers
          : s.kind === 'sheet'
            ? groups.sheeting
            : s.kind === 'gusset'
              ? groups.gussets
              : s.kind === 'brace'
              ? groups.braces
              : s.kind === 'tip'
                ? groups.tip
                : groups.edges
    const mesh = meshFrom(s, s.kind === 'web' ? behind(colour) : wood(colour))
    mesh.userData.colour = colour
    // The part it stands for: fixed for most, found from where it's clicked for a sheet or core
    // that runs over several parts
    if (s.pick) {
      mesh.userData.pick = s.pick
      if (!s.pick.groups) mesh.userData.partId = partFor(props.parts, s.pick, 0)
    }
    group.add(outlined(mesh))
  }
  for (const r of model.ribs) {
    const shape = new THREE.Shape(r.outline.map(([u, z]) => new THREE.Vector2(u, z)))
    for (const h of r.holes) shape.holes.push(new THREE.Path(h.map(([u, z]) => new THREE.Vector2(u, z))))
    const geo = new THREE.ExtrudeGeometry(shape, { depth: r.thickness, bevelEnabled: false, curveSegments: 1 })
    geo.applyMatrix4(new THREE.Matrix4().fromArray(r.matrix))
    const mesh = new THREE.Mesh(geo, behind(COLOURS.rib))
    mesh.userData.partId = r.id
    mesh.userData.colour = COLOURS.rib
    mesh.userData.centre = r.centre
    ;(r.surface ? groups.surfaces : groups.ribs).add(outlined(mesh))
  }
  for (const c of model.capStrips) {
    const shape = new THREE.Shape(c.outline.map(([u, z]) => new THREE.Vector2(u, z)))
    const geo = new THREE.ExtrudeGeometry(shape, { depth: c.thickness, bevelEnabled: false, curveSegments: 1 })
    geo.applyMatrix4(new THREE.Matrix4().fromArray(c.matrix))
    ;(c.surface ? groups.surfaces : groups.capStrips).add(outlined(new THREE.Mesh(geo, wood(COLOURS.sheet))))
  }
  mirror = root.clone()
  // The centre rib's gussets in the other half are the ones on its other face: their own part,
  // and their own material so they highlight apart
  mirror.traverse((m) => {
    if (!m.isMesh || !m.userData.pick?.mirrorMember) return
    m.material = m.material.clone()
    m.userData.partId = partFor(props.parts, m.userData.pick, 0, { mirrored: true })
  })
  mirror.scale.x = -1
  // The centre rib belongs to both halves: draw it once
  const ribsOther = mirror.getObjectByName('ribs')
  for (const m of [...ribsOther.children]) if (m.userData.centre) ribsOther.remove(m)
  scene.add(root)
  scene.add(mirror)
  present.value = Object.fromEntries(GROUPS.map((id) => [id, groups[id].children.length > 0]))
  applyVisibility()
  highlight()
  updateSection()
  bounds = model.bounds
  fitPts = model.skin.positions
  if (!framed) frame(shownBounds())
  render()
}

// The model's bounds, with the other half when it's shown
let bounds = null
let fitPts = new Float32Array(0) // the covering's vertices, which the wing fits inside
function shownBounds() {
  if (!bounds || !show.value.mirror) return bounds
  const m = Math.max(Math.abs(bounds.min[0]), Math.abs(bounds.max[0]))
  return { min: [-m, bounds.min[1], bounds.min[2]], max: [m, bounds.max[1], bounds.max[2]] }
}

// Frame the wing: by default from the home view (behind, above and inboard, as the card's
// thumbnail); or along a given view direction (target to camera). At the distance that just
// fits its bounding box in the view's actual proportions, so a long wing fills a wide card.
const FRAME_INSET = 44 // px kept clear at the top and bottom, for the corner controls
// Room left round the wing when it's fitted
const FIT_MARGIN = 1.05
// Framed by Home, Fit or on opening, and not moved since: a resize (the card expanding, the
// window changing) frames it again
let autoFramed = false
function frame(b, dir = HOME_VIEW, { animate = false } = {}) {
  const c = new THREE.Vector3(...b.min.map((v, k) => (v + b.max[k]) / 2))
  const size = Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2], 0.1)
  // The view direction (target to camera) and the camera's own axes looking along it (up is
  // always +Y for the orbit controls; the cube's top and bottom views lean a hair off it)
  const z = new THREE.Vector3(...dir).normalize()
  const x = new THREE.Vector3(0, 1, 0).cross(z).normalize()
  const y = z.clone().cross(x)
  const { w, h } = canvasSize()
  const aspect = w / h
  const tanV = Math.tan(((FOV / 2) * Math.PI) / 180)
  const tanH = tanV * aspect
  // Keep clear of the controls along the top and bottom edges
  const inset = h / Math.max(1, h - 2 * FRAME_INSET)
  // The wing's own outline as seen from here (the covering's points, with the other half if
  // it's shown), not its bounding box, whose corners are mostly empty: centre on it, then
  // fit it at this aspect
  const pts = []
  const halves = show.value.mirror ? [1, -1] : [1]
  for (let i = 0; i < fitPts.length; i += 3) {
    for (const k of halves) {
      const px = fitPts[i] * k - c.x
      const py = fitPts[i + 1] - c.y
      const pz = fitPts[i + 2] - c.z
      pts.push([px * x.x + py * x.y + pz * x.z, px * y.x + py * y.y + pz * y.z, px * z.x + py * z.y + pz * z.z])
    }
  }
  if (!pts.length) pts.push([0, 0, 0])
  const ext = (k) => [Math.min(...pts.map((p) => p[k])), Math.max(...pts.map((p) => p[k]))]
  const [x0, x1] = ext(0)
  const [y0, y1] = ext(1)
  const mx = (x0 + x1) / 2
  const my = (y0 + y1) / 2
  const target = c.clone().addScaledVector(x, mx).addScaledVector(y, my)
  // Orthographic: tall enough to hold it, and wide enough at this aspect
  const halfH = Math.max(((y1 - y0) / 2) * inset, (x1 - x0) / 2 / aspect) * FIT_MARGIN
  // Perspective: far enough that every point is inside both edges of the view
  let dist = 0
  for (const [px, py, pz] of pts) dist = Math.max(dist, pz + Math.abs(px - mx) / tanH, pz + (Math.abs(py - my) * inset) / tanV)
  dist *= FIT_MARGIN
  perspCam.near = Math.max(1e-4, dist / 500)
  perspCam.far = dist + size * 20
  perspCam.updateProjectionMatrix()
  // Nothing is clipped by being behind the orthographic camera; its scale is set by zoom, the
  // frustum staying as it is
  Object.assign(orthoCam, { near: -size * 20, far: size * 20 })
  orthoCam.updateProjectionMatrix()
  framed = true
  autoFramed = true
  moveTo({ target, offset: z.multiplyScalar(dist), zoom: orthoCam.top / halfH }, { animate })
}

function applyVisibility() {
  if (!root) return
  for (const g of [root, mirror]) for (const id of GROUPS) g.getObjectByName(id).visible = show.value[id]
  for (const g of [root, mirror]) g.traverse((o) => o.userData.outline && (o.visible = show.value.outlines))
  mirror.visible = show.value.mirror
  render()
}

function highlight() {
  const accent = new THREE.Color(cssColour('--wc-accent', '#1f6feb'))
  for (const g of [root, mirror]) {
    g.traverse((m) => {
      if (!m.isMesh || !m.userData.partId) return
      const on = m.userData.partId === props.selected
      m.material.color.set(on ? accent : m.userData.colour)
      m.material.emissive?.set(on ? accent.clone().multiplyScalar(0.25) : 0x000000)
    })
  }
  render()
}

// --- Section ---------------------------------------------------------------------------------

function updateSection() {
  if (!THREE || !root) return
  if (cut) {
    scene.remove(cut)
    disposeGroup(cut)
    cut = null
  }
  const on = section.value.on
  const s = Math.min(props.analysis.tipS, Math.max(props.analysis.rootS, section.value.s))
  if (on) {
    // Keep what's inboard of the cut (the plane's normal points inboard), or outboard if flipped
    const { point, normal } = spanPlane(props.analysis, s)
    const k = section.value.flip ? 1 : -1
    const n = new THREE.Vector3(k * normal[0], k * normal[1], k * normal[2])
    clip = new THREE.Plane(n, -n.dot(new THREE.Vector3(...point)))
  }
  root.traverse((o) => {
    if (o.material) {
      o.material.clippingPlanes = on ? [clip] : []
      o.material.needsUpdate = true
    }
  })
  if (on) {
    const a = props.analysis
    const sec = sectionAt(a, props.structure, props.parts, s)
    cut = new THREE.Group()
    const toWorld = ([x, h]) => new THREE.Vector3(...worldPoint(a, s, x, h))
    const lineMat = new THREE.LineBasicMaterial({ color: 0x3b2f20 })
    for (const piece of sec.pieces) {
      const contour = piece.pts.map(([x, h]) => new THREE.Vector2(x, h))
      if (THREE.ShapeUtils.isClockWise(contour)) contour.reverse()
      const holes = piece.holes.map((hole) => {
        const v = hole.map(([x, h]) => new THREE.Vector2(x, h))
        if (!THREE.ShapeUtils.isClockWise(v)) v.reverse()
        return v
      })
      const faces = THREE.ShapeUtils.triangulateShape(contour, holes)
      const geo = new THREE.BufferGeometry().setFromPoints([...contour, ...holes.flat()].map((v) => toWorld([v.x, v.y])))
      geo.setIndex(faces.flat())
      for (const hole of piece.holes) cut.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(hole.map(toWorld)), lineMat))
      const colour = new THREE.Color(piece.kind === 'spar' && props.structure.spar.type === 'tube' ? COLOURS.tube : COLOURS[piece.kind]).multiplyScalar(0.82)
      // A foam core is drawn first and pushed back, so the caps and web let into it show over it
      const fill = new THREE.MeshBasicMaterial({ color: colour, side: THREE.DoubleSide })
      if (piece.kind === 'core') Object.assign(fill, { polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 })
      cut.add(new THREE.Mesh(geo, fill))
      cut.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(piece.pts.map(toWorld)), lineMat))
    }
    if (sec.outline.length) {
      const accent = new THREE.Color(cssColour('--wc-accent', '#1f6feb'))
      cut.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(sec.outline.map(toWorld)), new THREE.LineBasicMaterial({ color: accent })))
    }
    scene.add(cut)
  }
  render()
}

// Swing the camera to look straight at the cut, from the side that's been cut away.
function lookAtCut() {
  if (!section.value.on) return
  const a = props.analysis
  const s = section.value.s
  const { normal } = spanPlane(a, s)
  const sec = a.section(s)
  const centre = new THREE.Vector3(...worldPoint(a, s, sec.xl + sec.c / 2, 0))
  const dist = sec.c * 1.8 * (section.value.flip ? -1 : 1)
  swingTo(new THREE.Vector3(...normal).multiplyScalar(dist).add(centre), centre)
}

// Keep the other part, and turn round to look at its cut face.
function flipSection() {
  section.value = { ...section.value, flip: !section.value.flip }
  lookAtCut()
}

// --- Orientation widgets -------------------------------------------------------------------

function makeCube() {
  cube.scene = new THREE.Scene()
  cube.camera = new THREE.OrthographicCamera(-0.95, 0.95, 0.95, -0.95, 0.1, 10)
  // BoxGeometry face order: +X, -X, +Y, -Y, +Z, -Z. X runs out to the tip, Y up, Z aft.
  const labels = ['Tip', 'Root', 'Top', 'Bottom', 'Back', 'Front']
  const text = cssColour('--wc-text', '#1b1f24')
  const face = cssColour('--wc-surface', '#f6f7f9')
  const border = cssColour('--wc-border', '#d9dde3')
  // Labels drawn well above the size they're shown at (a face covers up to ~200 device
  // pixels on a high-DPI screen), mipmapped and anisotropically filtered so they stay sharp
  // when the cube is turned
  const N = 512
  const materials = labels.map((l) => {
    const c = document.createElement('canvas')
    c.width = c.height = N
    const g = c.getContext('2d')
    g.fillStyle = face
    g.fillRect(0, 0, N, N)
    g.strokeStyle = border
    g.lineWidth = N * 0.045
    g.strokeRect(N * 0.0225, N * 0.0225, N * 0.955, N * 0.955)
    g.fillStyle = text
    g.font = `600 ${Math.round(N * 0.2)}px system-ui, sans-serif`
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(l, N / 2, N * 0.52)
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy()
    return new THREE.MeshBasicMaterial({ map: tex })
  })
  cube.mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), materials)
  cube.scene.add(cube.mesh)
}

function cubeRect(w, h) {
  return { x: w - cube.size - cube.margin, y: h - cube.size - cube.margin, s: cube.size }
}

function renderCube(w, h) {
  const dir = camera.position.clone().sub(controls.target).normalize()
  cube.camera.position.copy(dir.multiplyScalar(3))
  cube.camera.up.copy(camera.up)
  cube.camera.lookAt(0, 0, 0)
  const r = cubeRect(w, h)
  renderer.clearDepth()
  renderer.setScissorTest(true)
  renderer.setScissor(r.x, r.y, r.s, r.s)
  renderer.setViewport(r.x, r.y, r.s, r.s)
  renderer.render(cube.scene, cube.camera)
  renderer.setScissorTest(false)
  renderer.setViewport(0, 0, w, h)
}

// A click on the cube: swing round to look at the face clicked, from outside it.
function cubeClick(e) {
  const rect = renderer.domElement.getBoundingClientRect()
  const { w, h } = canvasSize()
  const r = cubeRect(w, h)
  // Canvas y is up from the bottom in GL terms; the event's is down from the top
  const px = e.clientX - rect.left - r.x
  const py = e.clientY - rect.top - (h - r.y - r.s)
  if (px < 0 || py < 0 || px > r.s || py > r.s) return false
  const ray = new THREE.Raycaster()
  ray.setFromCamera(new THREE.Vector2((px / r.s) * 2 - 1, -(py / r.s) * 2 + 1), cube.camera)
  const hit = ray.intersectObject(cube.mesh)[0]
  if (!hit) return true
  const f = hit.face.normal
  const off = camera.position.clone().sub(controls.target)
  const n = new THREE.Vector3(...faceView([f.x, f.y, f.z], off.toArray()))
  const dist = camera.position.distanceTo(controls.target)
  swingTo(n.normalize().multiplyScalar(dist).add(controls.target), controls.target.clone())
  return true
}

// Move the camera to a new target, offset from it (the view direction and, in perspective,
// the distance) and orthographic zoom: eased over a moment, round in heading and elevation
// (orbitLerp) so it never passes over the top or bottom and flips; or at once. Both cameras
// end up in step, so switching projection afterwards keeps the view.
let swinging = 0
const SWING_MS = 450
function moveTo({ target, offset, zoom = orthoCam.zoom }, { animate = true, ms = SWING_MS } = {}) {
  const fromTarget = controls.target.clone()
  const fromOffset = camera.position.clone().sub(fromTarget)
  const r0 = fromOffset.length()
  const r1 = offset.length()
  const a = fromOffset.toArray()
  const b = offset.toArray()
  const z0 = orthoCam.zoom
  const id = ++swinging
  const apply = (e) => {
    const off = new THREE.Vector3(...orbitLerp(a, b, e)).multiplyScalar(r0 + (r1 - r0) * e)
    controls.target.lerpVectors(fromTarget, target, e)
    camera.position.copy(controls.target).add(off)
    camera.lookAt(controls.target)
    orthoCam.zoom = z0 * Math.pow(zoom / z0, e) // even steps in scale
    orthoCam.updateProjectionMatrix()
  }
  const finish = () => {
    apply(1)
    const other = camera === orthoCam ? perspCam : orthoCam
    other.position.copy(camera.position)
    other.quaternion.copy(camera.quaternion)
    controls.update()
    render()
  }
  if (!animate) return finish()
  const t0 = performance.now()
  const step = (now) => {
    if (id !== swinging) return
    const t = Math.min(1, (now - t0) / ms)
    if (t >= 1) return finish()
    apply(t * t * (3 - 2 * t))
    render()
    requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
  // If the page gets no animation frames (a hidden pane), jump straight there
  setTimeout(() => {
    if (id === swinging && performance.now() - t0 > ms + 150) finish()
  }, ms + 250)
}
function swingTo(position, target) {
  autoFramed = false
  moveTo({ target, offset: position.clone().sub(target) })
}

// --- Pointer -------------------------------------------------------------------------------

// Click (not drag): the view cube first, then a part
let down = null
function onDown(e) {
  down = { x: e.clientX, y: e.clientY }
}
function onUp(e) {
  if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4 || !THREE) return
  if (cubeClick(e)) return
  const rect = renderer.domElement.getBoundingClientRect()
  const p = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1)
  const ray = new THREE.Raycaster()
  ray.setFromCamera(p, camera)
  // Every solid on a layer that's shown (the outlines don't take clicks)
  const targets = []
  for (const g of [root, ...(show.value.mirror ? [mirror] : [])]) {
    for (const id of GROUPS) if (show.value[id]) g.getObjectByName(id).traverse((o) => o.isMesh && targets.push(o))
  }
  const hits = ray.intersectObjects(targets, false)
  // Ignore anything the section has cut away
  const hit = hits.find((h) => !section.value.on || clip.distanceToPoint(h.point) >= -1e-6)
  if (!hit) return
  const o = hit.object
  let inMirror = false
  for (let q = o; q; q = q.parent) if (q === mirror) inMirror = true
  let id = inMirror && o.userData.pick?.mirrorMember ? null : o.userData.partId
  if (!id && o.userData.pick) {
    // Where along the span, in this half's own coordinates (the other half is mirrored in x)
    const p = hit.point
    id = partFor(props.parts, o.userData.pick, spanOf(props.analysis, [inMirror ? -p.x : p.x, p.y, p.z]), { mirrored: inMirror })
  }
  if (id) emit('select', id)
}

// Home: the starting angle, framed
function resetView() {
  if (!bounds) return
  frame(shownBounds(), HOME_VIEW, { animate: true })
}

// Fit: frame the wing from where the camera is looking now
function fitView() {
  if (!bounds) return
  const dir = camera.position.clone().sub(controls.target)
  frame(shownBounds(), [dir.x, dir.y, dir.z], { animate: true })
}

// Zoom about the centre of the view: closer in perspective, a larger scale in orthographic
// Repeated clicks build on where the last one was heading, not where the view has got to
let zoomGoal = null
function zoomBy(k) {
  if (!THREE) return
  autoFramed = false
  const target = controls.target.clone()
  const offset = camera.position.clone().sub(target)
  const ortho = camera === orthoCam
  const goal = zoomGoal && swinging === zoomGoal.id ? zoomGoal : { zoom: orthoCam.zoom, dist: offset.length() }
  const next = { zoom: goal.zoom * (ortho ? k : 1), dist: goal.dist / (ortho ? 1 : k) }
  moveTo({ target, offset: offset.setLength(next.dist), zoom: next.zoom }, { ms: 220 })
  zoomGoal = { ...next, id: swinging }
}

onMounted(async () => {
  try {
    THREE = await import('three')
    const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js')
    const utils = await import('three/examples/jsm/utils/BufferGeometryUtils.js')
    toCreasedNormals = utils.toCreasedNormals
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
    renderer.autoClear = false // the view cube draws over the scene
    renderer.localClippingEnabled = true
    wrapEl.value.appendChild(renderer.domElement)
    scene = new THREE.Scene()
    perspCam = new THREE.PerspectiveCamera(FOV, 1.6, 0.001, 100)
    orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, -100, 100)
    camera = perspCam
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a66, 1.6))
    const sun = new THREE.DirectionalLight(0xffffff, 1.4)
    sun.position.set(-1, 3, -2)
    scene.add(sun)
    controls = new OrbitControls(camera, renderer.domElement)
    controls.enableZoom = false
    controls.addEventListener('change', render)
    // Turning, panning or scrolling the view by hand: it's no longer as framed
    controls.addEventListener('start', () => {
      swinging++
      autoFramed = false
    })
    makeCube()
    renderer.domElement.addEventListener('pointerdown', onDown)
    renderer.domElement.addEventListener('pointerup', onUp)
    window.addEventListener('keydown', onKeydown)
    wrapEl.value.addEventListener('focusin', onZoomFocus)
    wrapEl.value.addEventListener('focusout', onZoomFocus)
    resizeObs = new ResizeObserver(size)
    resizeObs.observe(wrapEl.value)
    size()
    build()
    // Start in the chosen projection, framed for it (switching after framing for perspective
    // would keep the perspective view's looser framing)
    if (projection.value === 'orthographic') {
      camera = orthoCam
      controls.object = camera
      frame(shownBounds())
    }
    status.value = ''
  } catch (err) {
    console.error('3D view failed:', err)
    status.value = "The 3D view couldn't start here (WebGL may be unavailable)."
  }
})

onBeforeUnmount(() => {
  swinging++
  if (typeof document !== 'undefined') document.removeEventListener('pointerdown', onMenuPointer, true)
  window.removeEventListener('keydown', onKeydown)
  resizeObs?.disconnect()
  trackObs?.disconnect()
  controls?.dispose()
  disposeGroup(root)
  disposeGroup(cut)
  disposeGroup(cube.scene)
  renderer?.dispose()
  renderer?.domElement.remove()
})

watch(() => [props.analysis, props.parts, props.structure], build)
watch(() => props.selected, () => root && highlight())
watch(show, applyVisibility, { deep: true })
watch(section, updateSection, { deep: true })
watch(projection, setProjection)
</script>

<template>
  <figure class="wc-figure wc-3d">
    <!-- The view's controls sit in its corners: what's shown top left, orientation top right
         (around the cube, which three.js draws), framing bottom right, with the section bar
         beside it while the wing is cut -->
    <div
      ref="wrapEl"
      class="wc-3d__canvas"
      :class="{ 'wc-3d__canvas--cut': section.on }"
      tabindex="0"
      aria-label="3D view of the wing structure"
      @keydown="onViewKey"
      @pointerdown="focusView"
    >
      <p v-if="status" class="wc-3d__status wc-muted">{{ status }}</p>
      <div class="wc-stage__corner wc-stage__corner--tl" role="toolbar" aria-label="Show">
        <div ref="menuEl" class="wc-3d__menu" @focusout="onMenuFocusOut">
          <button
            type="button"
            class="wc-button wc-stage__btn"
            :aria-expanded="String(menu === 'layers')"
            aria-controls="wc-3d-layers"
            title="Show and hide parts"
            @click="toggleMenu('layers')"
          >
            Layers
          </button>
          <!-- Closes on Esc, its button, or a press or focus outside the menu and its button -->
          <div v-if="menu === 'layers'" id="wc-3d-layers" class="wc-layers" :style="{ maxHeight: menuMax }" role="group" aria-label="Layers">
            <h4 class="wc-layers__head">Show</h4>
            <ul class="wc-layers__rows">
              <li v-for="l in LAYERS.filter(shown)" :key="l.id" class="wc-layers__row" :class="{ 'wc-layers__row--off': !show[l.id] }">
                <span class="wc-layers__name">{{ layerLabel(l) }}</span>
                <button
                  type="button"
                  class="wc-layers__icon"
                  :aria-pressed="String(show[l.id])"
                  :title="`${show[l.id] ? 'Hide' : 'Show'} ${layerLabel(l).toLowerCase()}`"
                  @click="show[l.id] = !show[l.id]"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path v-for="(d, k) in show[l.id] ? EYE : EYE_OFF" :key="k" :d="d" /></svg>
                </button>
              </li>
            </ul>
          </div>
        </div>
        <button
          type="button"
          class="wc-button wc-stage__btn wc-3d__section-btn"
          :class="{ 'wc-3d__tool--active': section.on }"
          :aria-pressed="String(section.on)"
          :title="section.on ? 'Put the wing back together' : 'Cut the wing open across the span'"
          @click="toggleSection(!section.on)"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path v-for="(d, k) in CUT" :key="k" :d="d" /></svg>
          Section
        </button>
      </div>
      <div v-if="!status" class="wc-3d__orient" :style="{ right: `${cube.size + cube.margin * 2}px`, top: `${cube.margin}px` }">
        <button type="button" class="wc-3d__home" aria-label="Home view" title="Home view: back to the starting angle" @click="resetView">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path v-for="(d, k) in HOME" :key="k" :d="d" /></svg>
        </button>
        <button
          type="button"
          class="wc-3d__home"
          :aria-label="projectionText.label"
          :title="projectionText.title"
          @click="projection = projection === 'orthographic' ? 'perspective' : 'orthographic'"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path v-for="(d, k) in projection === 'orthographic' ? ORTHO : PERSPECTIVE" :key="k" :d="d" /></svg>
        </button>
      </div>
      <!-- Along the bottom: the section bar while the wing is cut, then the zoom controls -->
      <div class="wc-3d__bottom">
        <div v-if="section.on" class="wc-3d__sectionbar" role="group" aria-label="Section">
          <div ref="trackEl" class="wc-3d__track">
            <template v-for="t in ribTicks" :key="t.id">
              <span class="wc-3d__tick" :class="{ 'wc-3d__tick--near': t.near }" :style="{ left: `${t.at * 100}%` }" :title="t.name" />
              <span v-if="t.named" class="wc-3d__ticklabel" :class="{ 'wc-3d__ticklabel--near': t.near }" :style="{ left: `${t.at * 100}%` }" aria-hidden="true">{{ t.name }}</span>
            </template>
            <input
              class="wc-3d__slider"
              type="range"
              :min="sectionRange.min"
              :max="sectionRange.max"
              step="0.0005"
              :value="section.s"
              aria-label="Where to cut, along the span"
              :aria-valuetext="sectionLabel"
              @input="moveCut(Number($event.target.value))"
            />
          </div>
          <span class="wc-3d__readout">{{ sectionLabel }}</span>
          <button type="button" class="wc-button wc-button--small" :title="section.flip ? 'Keep the inboard part' : 'Keep the outboard part'" @click="flipSection">
            Flip
          </button>
          <button type="button" class="wc-button wc-button--small" title="Swing round to face the cut" @click="lookAtCut">Look at cut</button>
          <button type="button" class="wc-3d__close" aria-label="Close the section" title="Close the section" @click="toggleSection(false)">×</button>
        </div>
        <StageZoom fit-title="Frame the wing from this angle (F)" @zoom-in="zoomBy(1.25)" @zoom-out="zoomBy(1 / 1.25)" @fit="fitView" />
      </div>
    </div>
    <figcaption class="wc-figure__caption">
      Drag to turn, right-drag to move, scroll to zoom; <template v-if="!foam">click a rib to select it, or </template>a face of
      the cube to see the wing from that side. Twist and dihedral are true to scale.<template v-if="foam">
        The foam core hides the spar caps let into it: turn its layer off to see them.</template>
    </figcaption>
  </figure>
</template>
