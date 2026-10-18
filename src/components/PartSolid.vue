<script setup>
// One part in 3D: its outline and holes cut from a sheet of its thickness, with its engraved
// lines on the face, at true proportions. Drag to turn it, right-drag to move it, and while the
// view has focus scroll, + and − zoom and F fits; − + Fit in the corner as in the other views.
// three.js loads on first use (the wing's 3D view shares the chunk) and renders on demand.
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import StageZoom from './StageZoom.vue'

const props = defineProps({
  part: { type: Object, required: true },
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
// Looking at the face from in front, a little above and to one side, so its thickness shows
const VIEW = [0.45, -0.55, 1]
const WOOD = 0xd9b77e
const MATERIAL_COLOURS = { mylar: 0xb8c4cc, 'template-stock': 0xc9ced4 }

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
  const p = props.part
  const t = Math.max(p.thickness || 0, 1e-4)
  body = new THREE.Group()
  const v2 = ([u, z]) => new THREE.Vector2(u, z)
  const shape = new THREE.Shape(p.outline.map(v2))
  for (const h of p.holes ?? []) shape.holes.push(new THREE.Path(h.map(v2)))
  const geo = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false, curveSegments: 1 })
  const mat = new THREE.MeshStandardMaterial({ color: MATERIAL_COLOURS[p.material] ?? WOOD, roughness: 0.85, metalness: 0, side: THREE.DoubleSide })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), new THREE.LineBasicMaterial({ color: 0x5b4a32, transparent: true, opacity: 0.6 })))
  body.add(mesh)
  // Engraved lines on the front face, just proud of it so they don't flicker
  const etch = new THREE.LineBasicMaterial({ color: new THREE.Color(cssColour('--wc-accent', '#1f6feb')) })
  for (const e of p.etch ?? []) {
    if (e.length < 2) continue
    const g = new THREE.BufferGeometry().setFromPoints(e.map(([u, z]) => new THREE.Vector3(u, z, t + t * 0.02 + 1e-5)))
    body.add(new THREE.Line(g, etch))
  }
  scene.add(body)
  fit(VIEW)
}

// Frame the part from a view direction (target to camera), or from where the camera is now
function fit(dir) {
  if (!body) return
  const box = new THREE.Box3().setFromObject(body)
  const c = box.getCenter(new THREE.Vector3())
  const d = dir ? new THREE.Vector3(...dir).normalize() : camera.position.clone().sub(controls.target).normalize()
  const x = new THREE.Vector3(0, 1, 0).cross(d).normalize()
  const y = d.clone().cross(x)
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
  const r = box.getSize(new THREE.Vector3()).length()
  // Room for the corner buttons along the bottom
  const half = Math.max(hy * (h / Math.max(1, h - 64)), (hx * h) / w, 1e-3) * 1.08
  Object.assign(camera, { left: (-half * w) / h, right: (half * w) / h, top: half, bottom: -half, near: -r * 10, far: r * 10, zoom: 1 })
  camera.position.copy(c).addScaledVector(d, r * 2)
  camera.up.set(0, 1, 0)
  controls.target.copy(c)
  camera.updateProjectionMatrix()
  controls.update()
  render()
}

function zoomBy(k) {
  if (!camera) return
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

watch(() => props.part, build)

onBeforeUnmount(() => {
  resizeObs?.disconnect()
  controls?.dispose()
  dispose(body)
  renderer?.dispose()
})
</script>

<template>
  <div ref="wrapEl" class="wc-part__solid" tabindex="0" aria-label="The part in 3D: drag to turn it" @pointerdown="focusView" @keydown="onKey">
    <p v-if="status" class="wc-part__status">{{ status }}</p>
    <StageZoom fit-title="Fit the part to the view (F)" @zoom-in="zoomBy(1.25)" @zoom-out="zoomBy(1 / 1.25)" @fit="fit(VIEW)" />
  </div>
</template>
