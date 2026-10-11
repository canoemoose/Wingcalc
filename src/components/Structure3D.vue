<script setup>
// The built-up half wing in 3D: see-through skin, ribs at their thickness, spar, webs, edge
// stock and stringers. Drag to orbit, right-drag or Shift-drag to pan, scroll to zoom; click a
// rib to select it (shared with the plan and the part preview). three.js loads on first use,
// so it costs nothing until the view is opened. It renders on demand, not in a loop.
import { ref, shallowRef, watch, onMounted, onBeforeUnmount, computed } from 'vue'
import { wing3d } from '../lib/wing3d.js'

const props = defineProps({
  analysis: { type: Object, required: true },
  structure: { type: Object, required: true },
  parts: { type: Array, required: true },
  selected: { type: String, default: null },
})
const emit = defineEmits(['select'])

const wrapEl = ref(null)
const status = ref('Loading the 3D view…')
const show = ref({ skin: true, ribs: true, spar: true, edges: true, stringers: true, mirror: false })
const LAYERS = [
  { id: 'skin', label: 'Skin' },
  { id: 'ribs', label: 'Ribs' },
  { id: 'spar', label: 'Spar and webs' },
  { id: 'edges', label: 'Edges' },
  { id: 'stringers', label: 'Stringers' },
  { id: 'mirror', label: 'Both halves' },
]
const hasStringers = computed(() => (props.structure.stringers ?? []).length > 0)

let THREE = null
let renderer = null
let scene = null
let camera = null
let controls = null
let root = null // this half
let mirror = null // the other half
let resizeObs = null
const ribMeshes = shallowRef([])
let framed = false

const COLOURS = { rib: 0xd9b77e, spar: 0xb98a4e, web: 0xe6cf9f, le: 0xe3c48f, te: 0xe3c48f, stringer: 0xc9a46a, tube: 0x2f3337 }

function cssColour(name, fallback) {
  const v = wrapEl.value ? getComputedStyle(wrapEl.value).getPropertyValue(name).trim() : ''
  return v || fallback
}

function render() {
  if (renderer && scene && camera) renderer.render(scene, camera)
}

function size() {
  const el = wrapEl.value
  const w = el?.clientWidth || 640
  const h = el?.clientHeight || 400
  renderer.setSize(w, h, false)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  render()
}

function disposeGroup(g) {
  g?.traverse((o) => {
    o.geometry?.dispose()
    if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose())
    else o.material?.dispose()
  })
}

function meshFrom(data, material) {
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3))
  geo.setIndex(new THREE.BufferAttribute(data.indices, 1))
  geo.computeVertexNormals()
  return new THREE.Mesh(geo, material)
}

function build() {
  if (!THREE) return
  const model = wing3d(props.analysis, props.structure, props.parts)
  if (root) {
    scene.remove(root)
    scene.remove(mirror)
    disposeGroup(root)
  }
  root = new THREE.Group()
  const groups = {}
  for (const id of ['skin', 'ribs', 'spar', 'edges', 'stringers']) {
    groups[id] = new THREE.Group()
    groups[id].name = id
    root.add(groups[id])
  }
  const wood = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, metalness: 0, side: THREE.DoubleSide })
  const skinMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(cssColour('--wc-accent', '#1f6feb')),
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
    side: THREE.DoubleSide,
    roughness: 0.4,
  })
  const skin = meshFrom(model.skin, skinMat)
  skin.renderOrder = 2
  groups.skin.add(skin)
  const tube = props.structure.spar.type === 'tube'
  for (const s of model.solids) {
    const colour = s.kind === 'spar' && tube ? COLOURS.tube : COLOURS[s.kind]
    const group = s.kind === 'spar' || s.kind === 'web' ? groups.spar : s.kind === 'stringer' ? groups.stringers : groups.edges
    group.add(meshFrom(s, wood(colour)))
  }
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x5b4a32, transparent: true, opacity: 0.55 })
  const meshes = []
  for (const r of model.ribs) {
    const shape = new THREE.Shape(r.outline.map(([u, z]) => new THREE.Vector2(u, z)))
    for (const h of r.holes) shape.holes.push(new THREE.Path(h.map(([u, z]) => new THREE.Vector2(u, z))))
    const geo = new THREE.ExtrudeGeometry(shape, { depth: r.thickness, bevelEnabled: false, curveSegments: 1 })
    geo.applyMatrix4(new THREE.Matrix4().fromArray(r.matrix))
    const mesh = new THREE.Mesh(geo, wood(COLOURS.rib))
    mesh.userData.partId = r.id
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), edgeMat)
    mesh.add(edges)
    groups.ribs.add(mesh)
    meshes.push(mesh)
  }
  ribMeshes.value = meshes
  mirror = root.clone()
  mirror.scale.x = -1
  scene.add(root)
  scene.add(mirror)
  applyVisibility()
  highlight()
  if (!framed) frame(model.bounds)
  render()
}

function frame(b) {
  const c = b.min.map((v, k) => (v + b.max[k]) / 2)
  const size = Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2], 0.1)
  // From ahead, above and a little outboard, looking at the half wing
  camera.position.set(c[0] - size * 0.15, c[1] + size * 0.55, c[2] - size * 1.05)
  camera.near = size / 200
  camera.far = size * 20
  camera.updateProjectionMatrix()
  controls.target.set(c[0], c[1], c[2])
  controls.update()
  framed = true
}

function applyVisibility() {
  if (!root) return
  for (const g of [root, mirror]) for (const id of ['skin', 'ribs', 'spar', 'edges', 'stringers']) g.getObjectByName(id).visible = show.value[id]
  mirror.visible = show.value.mirror
  render()
}

function highlight() {
  const accent = new THREE.Color(cssColour('--wc-accent', '#1f6feb'))
  for (const g of [root, mirror]) {
    g.getObjectByName('ribs').children.forEach((m) => {
      const on = m.userData.partId === props.selected
      m.material.color.set(on ? accent : COLOURS.rib)
      m.material.emissive?.set(on ? accent.clone().multiplyScalar(0.25) : 0x000000)
    })
  }
  render()
}

// Click (not drag) on a rib selects it
let down = null
function onDown(e) {
  down = { x: e.clientX, y: e.clientY }
}
function onUp(e) {
  if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4 || !THREE) return
  const rect = renderer.domElement.getBoundingClientRect()
  const p = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1)
  const ray = new THREE.Raycaster()
  ray.setFromCamera(p, camera)
  const targets = [root, ...(show.value.mirror ? [mirror] : [])].flatMap((g) => g.getObjectByName('ribs').children)
  const hit = show.value.ribs ? ray.intersectObjects(targets, false)[0] : null
  if (hit?.object.userData.partId) emit('select', hit.object.userData.partId)
}

function resetView() {
  framed = false
  build()
}

onMounted(async () => {
  try {
    THREE = await import('three')
    const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js')
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
    wrapEl.value.appendChild(renderer.domElement)
    scene = new THREE.Scene()
    camera = new THREE.PerspectiveCamera(35, 1.6, 0.001, 100)
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a66, 1.6))
    const sun = new THREE.DirectionalLight(0xffffff, 1.4)
    sun.position.set(-1, 3, -2)
    scene.add(sun)
    controls = new OrbitControls(camera, renderer.domElement)
    controls.addEventListener('change', render)
    renderer.domElement.addEventListener('pointerdown', onDown)
    renderer.domElement.addEventListener('pointerup', onUp)
    resizeObs = new ResizeObserver(size)
    resizeObs.observe(wrapEl.value)
    size()
    build()
    status.value = ''
  } catch (err) {
    console.error('3D view failed:', err)
    status.value = "The 3D view couldn't start here (WebGL may be unavailable)."
  }
})

onBeforeUnmount(() => {
  resizeObs?.disconnect()
  controls?.dispose()
  disposeGroup(root)
  renderer?.dispose()
  renderer?.domElement.remove()
})

watch(() => [props.analysis, props.parts, props.structure], build)
watch(() => props.selected, () => root && highlight())
watch(show, applyVisibility, { deep: true })
</script>

<template>
  <figure class="wc-figure wc-3d">
    <div class="wc-3d__bar" role="group" aria-label="Show in 3D">
      <label v-for="l in LAYERS.filter((x) => x.id !== 'stringers' || hasStringers)" :key="l.id" class="wc-check">
        <input v-model="show[l.id]" type="checkbox" /> {{ l.label }}
      </label>
      <button type="button" class="wc-button wc-button--small" @click="resetView">Reset view</button>
    </div>
    <div ref="wrapEl" class="wc-3d__canvas">
      <p v-if="status" class="wc-3d__status wc-muted">{{ status }}</p>
    </div>
    <figcaption class="wc-figure__caption">
      Drag to turn, right-drag to move, scroll to zoom. Click a rib to select it. Twist and dihedral are true to scale.
    </figcaption>
  </figure>
</template>
