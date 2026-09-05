import * as THREE from 'three'

export const PALETTE = {
  night: 0x0a0d0c,
  moss: 0x263a27,
  mossLight: 0x5f7541,
  wheat: 0xd6a84d,
  wheatLight: 0xf4cf72,
  stone: 0x5b5a50,
  stoneLight: 0x8d8975,
  flour: 0xf1e7d0,
  salt: 0xf8f0da,
  yeast: 0xc3885f,
  dough: 0xc98a4c,
  doughLight: 0xf0b86a,
  oven: 0x251512,
  ember: 0xff6f32,
  crust: 0x9a4b20,
  bread: 0xc8752c,
  crumb: 0xf3c681,
  table: 0x433126,
  ink: 0x111612,
} as const

export function material(
  color: THREE.ColorRepresentation,
  options: Partial<THREE.MeshStandardMaterialParameters> = {},
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.86,
    metalness: 0.02,
    transparent: true,
    ...options,
  })
}

export function pointsMaterial(color: THREE.ColorRepresentation, size: number, opacity = 0.8) {
  return new THREE.PointsMaterial({
    color,
    size,
    sizeAttenuation: true,
    transparent: true,
    opacity,
    depthWrite: false,
  })
}

export function blobGeometry(width: number, height: number, depth: number, detail = 2) {
  const geometry = new THREE.IcosahedronGeometry(1, detail)
  const position = geometry.attributes.position
  const vertex = new THREE.Vector3()

  for (let i = 0; i < position.count; i += 1) {
    vertex.fromBufferAttribute(position, i)
    const absX = Math.abs(vertex.x)
    const crown = Math.max(0, vertex.y)
    const taper = 1 - absX * 0.16
    vertex.x *= width * taper
    vertex.y = vertex.y * height + crown * 0.08
    vertex.z *= depth * (1 - Math.max(0, absX - 0.55) * 0.12)
    if (vertex.y < -height * 0.42) vertex.y *= 0.62
    position.setXYZ(i, vertex.x, vertex.y, vertex.z)
  }

  position.needsUpdate = true
  geometry.computeVertexNormals()
  return geometry
}

export function kernelGeometry() {
  const profile = [
    new THREE.Vector2(0.02, -0.86),
    new THREE.Vector2(0.16, -0.72),
    new THREE.Vector2(0.28, -0.4),
    new THREE.Vector2(0.34, 0),
    new THREE.Vector2(0.27, 0.43),
    new THREE.Vector2(0.12, 0.75),
    new THREE.Vector2(0.02, 0.88),
  ]
  const geometry = new THREE.LatheGeometry(profile, 10)
  geometry.rotateZ(Math.PI / 2)
  geometry.scale(0.56, 0.56, 1.18)
  geometry.computeVertexNormals()
  return geometry
}

export function fieldKernelGeometry() {
  const profile = [
    new THREE.Vector2(0.01, -0.62),
    new THREE.Vector2(0.1, -0.52),
    new THREE.Vector2(0.18, -0.25),
    new THREE.Vector2(0.2, 0),
    new THREE.Vector2(0.16, 0.27),
    new THREE.Vector2(0.08, 0.48),
    new THREE.Vector2(0.01, 0.62),
  ]
  const geometry = new THREE.LatheGeometry(profile, 8)
  geometry.computeVertexNormals()
  return geometry
}

export function loafGeometry() {
  const shape = new THREE.Shape()
  shape.moveTo(-1.56, -0.5)
  shape.lineTo(1.56, -0.5)
  shape.quadraticCurveTo(1.54, -0.28, 1.42, -0.04)
  shape.quadraticCurveTo(1.27, 0.4, 0.78, 0.67)
  shape.quadraticCurveTo(0.22, 0.92, -0.22, 0.86)
  shape.quadraticCurveTo(-0.86, 0.78, -1.22, 0.41)
  shape.quadraticCurveTo(-1.47, 0.13, -1.56, -0.18)
  shape.quadraticCurveTo(-1.62, -0.37, -1.56, -0.5)

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 1.5,
    bevelEnabled: true,
    bevelSegments: 2,
    bevelSize: 0.13,
    bevelThickness: 0.12,
    curveSegments: 5,
    steps: 1,
  })
  geometry.translate(0, 0, -0.75)
  geometry.computeVertexNormals()
  return geometry
}

export function setOpacity(object: THREE.Object3D, value: number) {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []
    materials.forEach((entry) => {
      entry.transparent = true
      entry.opacity = THREE.MathUtils.clamp(value, 0, 1)
      entry.depthWrite = value > 0.96
    })
  })
}

export function smoothstep(value: number) {
  const v = THREE.MathUtils.clamp(value, 0, 1)
  return v * v * (3 - 2 * v)
}

export function smootherstep(value: number) {
  const v = THREE.MathUtils.clamp(value, 0, 1)
  return v * v * v * (v * (v * 6 - 15) + 10)
}

export function rangeProgress(progress: number, start: number, end: number) {
  return THREE.MathUtils.clamp((progress - start) / Math.max(end - start, 0.0001), 0, 1)
}

export function overlapOpacity(progress: number, start: number, end: number, feather = 0.08) {
  const fadeIn = smoothstep((progress - start) / feather)
  const fadeOut = 1 - smoothstep((progress - (end - feather)) / feather)
  return THREE.MathUtils.clamp(Math.min(fadeIn, fadeOut), 0, 1)
}

export function createScoreCut(materialInstance: THREE.Material, width = 0.72) {
  const cut = new THREE.Mesh(new THREE.BoxGeometry(width, 0.075, 0.1), materialInstance)
  cut.rotation.z = -0.2
  cut.rotation.x = -0.24
  return cut
}
