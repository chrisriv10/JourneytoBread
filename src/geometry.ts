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
