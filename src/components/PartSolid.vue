<script setup>
// One piece in 3D on its own: as it sits in the wing (its solids from the 3D model, and a rib or
// cap strip's outline placed by its matrix), or a part that isn't drawn in the wing as a solid
// of its thickness with its engraved lines on the face. Drag to turn it, right-drag to move it, and while the view has focus scroll, + and −
// zoom and F fits; − + Fit in the corner as in the other views, and the house top right goes
// back to the view it opens in: a piece from the wing the same way round as the wing's 3D view
// shows it (a three-quarter view until that has been seen), a part not drawn in the wing in a
// three-quarter view. Fit keeps the angle; both ease into place.
// three.js loads on first use (the wing's 3D view shares the chunk) and renders on demand.
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import StageZoom from './StageZoom.vue'
import { HOME } from '../lib/icons.js'

const props = defineProps({
  // { solids, plates, material, kind }: the piece as placed (wing3d solids, and ribs or cap
  // strips: { outline, holes, thickness, matrix }); or { flat: part, material }
  subject: { type: Object, required: true },
  // The wing's 3D view's direction (target to camera), when it has one
  viewDir: { type: Array, default: null },
})

const wrapEl = ref(null)
const status = ref('Loading the 3D view…')

let THREE = null
let renderer = null
let scene = null
let camera = null
let controls = null
let body = null
let resizeObs = null
let toCreasedNormals = null
const WOOD = 0xd9b77e
const MATERIAL_COLOURS = { mylar: 0xb8c4cc, 'template-stock': 0xc9ced4, 'carbon-tube': 0x2f3337 }
// As in the wing's 3D view
const KIND_COLOURS = { servo: 0x3a3f45, servoOutput: 0xf2f2ee, servoLead: 0xd9a400, tab: 0x8fa3ad, blade: 0x7f8c97, core: 0xe9e5d8, coreMoving: 0xe9e5d8, sheet: 0xecd9b0, plate: 0xa8794a }
const EASE_MS = 320

const size = () => ({ w: wrapEl.value?.clientWidth || 320, h: wrapEl.value?.clientHeight || 220 })

function render() {
  if (renderer && scene && camera) renderer.render(scene, camera)
}

function cssColour(name, fallback) {
  const v = wrapEl.value ? getComputedStyle(wrapEl.value).getPropertyValue(name).trim() : ''
  return v || fallback
}

function dispose(g) {
  g?.traverse((o) => {
    o.geometry?.dispose()
    o.material?.dispose()
  })
}

function build() {
  if (!THREE || !scene) return
  if (body) {
    scene.remove(body)
    dispose(body)
  }
  const sub = props.subject
  body = new THREE.Group()
  const colourOf = (kind) => KIND_COLOURS[kind] ?? MATERIAL_COLOURS[sub.material] ?? WOOD
  const edges = new THREE.LineBasicMaterial({ color: 0x5b4a32, transparent: true, opacity: 0.6 })
  const add = (geo, colour) => {
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: colour, roughness: 0.85, metalness: 0, side: THREE.DoubleSide }))
    mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), edges))
    body.add(mesh)
  }
  const v2 = ([u, z]) => new THREE.Vector2(u, z)
  const extrude = (p, depth) => {
    const shape = new THREE.Shape(p.outline.map(v2))
    for (const h of p.holes ?? []) shape.holes.push(new THREE.Path(h.map(v2)))
    return new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 1 })
  }
  if (sub.flat) {
    const p = sub.flat
    const t = Math.max(p.thickness || 0, 1e-4)
    add(extrude(p, t), colourOf(null))
    // Engraved lines on the front face, just proud of it so they don't flicker
    const etch = new THREE.LineBasicMaterial({ color: new THREE.Color(cssColour('--wc-accent', '#1f6feb')) })
    for (const e of p.etch ?? []) {
      if (e.length < 2) continue
      const g = new THREE.BufferGeometry().setFromPoints(e.map(([u, z]) => new THREE.Vector3(u, z, t + t * 0.02 + 1e-5)))
      body.add(new THREE.Line(g, etch))
    }
  } else {
    // As placed in the wing: smooth over gentle curves, sharp at corners, as in the wing's view
    for (const sol of sub.solids ?? []) {
      let geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(sol.positions, 3))
      geo.setIndex(new THREE.BufferAttribute(sol.indices, 1))
      if (toCreasedNormals) geo = toCreasedNormals(geo, Math.PI / 6)
      else geo.computeVertexNormals()
      add(geo, colourOf(sol.kind))
    }
    for (const p of sub.plates ?? []) {
      const geo = extrude(p, p.thickness)
      geo.applyMatrix4(new THREE.Matrix4().fromArray(p.matrix))
      add(geo, sub.kind === 'capStrip' ? KIND_COLOURS.sheet : colourOf(null))
    }
  }
  scene.add(body)
  home(false)
}

// The three-quarter view for this part: mostly square to its broadest face (across its
// thinnest dimension), turned a third of the way towards its length and looking a little down,
// so a plate shows its face and edge and a stick shows its side, length and an end
function homeDir() {
  const s = new THREE.Box3().setFromObject(body).getSize(new THREE.Vector3())
  const dims = [s.x, s.y, s.z]
  const thin = dims.indexOf(Math.min(...dims))
  const rest = [0, 1, 2].filter((k) => k !== thin)
  const long = dims[rest[0]] >= dims[rest[1]] ? rest[0] : rest[1]
  const d = [0, 0, 0]
  d[thin] += 0.8
  d[long] += 0.45
  // A little from above: up is y, or failing that the third axis
  d[thin === 1 || long === 1 ? rest.find((k) => k !== long) : 1] += 0.35
  return new THREE.Vector3(...d).normalize()
}

// Where the camera goes to fit the part looking along dir (target to camera)
function fitPose(dir) {
  const box = new THREE.Box3().setFromObject(body)
  const c = box.getCenter(new THREE.Vector3())
  const z = dir.clone().normalize()
  const x = new THREE.Vector3(0, 1, 0).cross(z)
  if (x.lengthSq() < 1e-8) x.set(1, 0, 0)
  x.normalize()
  const y = z.clone().cross(x)
  let hx = 0
  let hy = 0
  for (const i of [0, 1]) {
    for (const j of [0, 1]) {
      for (const k of [0, 1]) {
        const q = new THREE.Vector3(i ? box.max.x : box.min.x, j ? box.max.y : box.min.y, k ? box.max.z : box.min.z).sub(c)
        hx = Math.max(hx, Math.abs(q.dot(x)))
        hy = Math.max(hy, Math.abs(q.dot(y)))
      }
    }
  }
  const { w, h } = size()
  // Clear of the corner buttons along the bottom
  const half = Math.max(hy * (h / Math.max(1, h - 72)), (hx * h) / w, 1e-3) * 1.1
  const r = box.getSize(new THREE.Vector3()).length()
  return { target: c, dir: z, dist: r * 2, zoom: (camera.top - camera.bottom) / 2 / half, r }
}

// Ease the camera to a pose: target, view direction and zoom together
let anim = 0
function moveTo(pose, animate = true) {
  const r = pose.r
  camera.near = -r * 10
  camera.far = r * 10
  const from = { target: controls.target.clone(), dir: camera.position.clone().sub(controls.target).normalize(), zoom: camera.zoom }
  const apply = (t) => {
    const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
    const target = from.target.clone().lerp(pose.target, e)
    const dir = from.dir.clone().lerp(pose.dir, e)
    if (dir.lengthSq() < 1e-8) dir.copy(pose.dir)
    dir.normalize()
    controls.target.copy(target)
    camera.position.copy(target).addScaledVector(dir, pose.dist)
    camera.zoom = from.zoom + (pose.zoom - from.zoom) * e
    camera.updateProjectionMatrix()
    controls.update()
    render()
  }
  const id = ++anim
  if (!animate || typeof requestAnimationFrame === 'undefined' || document.hidden) return apply(1)
  const t0 = performance.now()
  const step = (now) => {
    if (id !== anim) return
    const t = Math.min(1, (now - t0) / EASE_MS)
    apply(t)
    if (t < 1) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

// Fit: the whole part in view from where the camera is looking now
function fit() {
  if (!body) return
  moveTo(fitPose(camera.position.clone().sub(controls.target)))
}
// Home: as the wing's 3D view looks at a placed piece, else the three-quarter view; fitted
function home(animate = true) {
  if (!body) return
  const dir = !props.subject.flat && props.viewDir ? new THREE.Vector3(...props.viewDir) : homeDir()
  moveTo(fitPose(dir), animate)
}

function zoomBy(k) {
  if (!camera) return
  anim++
  camera.zoom *= k
  camera.updateProjectionMatrix()
  render()
}

function resize() {
  if (!renderer) return
  const { w, h } = size()
  renderer.setSize(w, h, false)
  const half = (camera.top - camera.bottom) / 2
  camera.left = (-half * w) / h
  camera.right = (half * w) / h
  camera.updateProjectionMatrix()
  render()
}

// The wheel zooms only while focus is inside the view; otherwise the page scrolls
function onFocus(e) {
  if (controls) controls.enableZoom = e.type === 'focusin' || !!wrapEl.value?.contains(e.relatedTarget)
}
function onKey(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return
  if (e.key === 'f' || e.key === 'F') fit()
  else if (e.key === '+' || e.key === '=') zoomBy(1.25)
  else if (e.key === '-' || e.key === '_') zoomBy(1 / 1.25)
  else return
  e.preventDefault()
}
function focusView(e) {
  if (!e.target.closest('button')) wrapEl.value?.focus({ preventScroll: true })
}

onMounted(async () => {
  try {
    THREE = await import('three')
    const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js')
    toCreasedNormals = (await import('three/examples/jsm/utils/BufferGeometryUtils.js')).toCreasedNormals
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
    wrapEl.value.appendChild(renderer.domElement)
    scene = new THREE.Scene()
    camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10)
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a66, 1.6))
    const sun = new THREE.DirectionalLight(0xffffff, 1.4)
    sun.position.set(1, 2, 3)
    scene.add(sun)
    controls = new OrbitControls(camera, renderer.domElement)
    controls.enableZoom = false
    controls.addEventListener('change', render)
    // Turning it by hand stops any easing
    controls.addEventListener('start', () => anim++)
    wrapEl.value.addEventListener('focusin', onFocus)
    wrapEl.value.addEventListener('focusout', onFocus)
    resizeObs = new ResizeObserver(resize)
    resizeObs.observe(wrapEl.value)
    resize()
    build()
    status.value = ''
  } catch (err) {
    console.error('Part 3D view failed:', err)
    status.value = "The 3D view couldn't start here (WebGL may be unavailable)."
  }
})

watch(() => props.subject, build)

onBeforeUnmount(() => {
  anim++
  resizeObs?.disconnect()
  controls?.dispose()
  dispose(body)
  renderer?.dispose()
})
</script>

<template>
  <div ref="wrapEl" class="wc-part__solid" tabindex="0" aria-label="The part in 3D: drag to turn it" @pointerdown="focusView" @keydown="onKey">
    <p v-if="status" class="wc-part__status">{{ status }}</p>
    <button v-else type="button" class="wc-3d__home wc-part__home" aria-label="Home view" title="Home view: the three-quarter view" @click="home()">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path v-for="(d, k) in HOME" :key="k" :d="d" /></svg>
    </button>
    <StageZoom fit-title="Fit the part to the view (F)" @zoom-in="zoomBy(1.25)" @zoom-out="zoomBy(1 / 1.25)" @fit="fit" />
  </div>
</template>
