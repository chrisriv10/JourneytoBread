import * as T from 'three'

// All dimensions are in the same tabletop coordinate system: the work surface is y=0.
export type ChapterModel = { group: T.Group; animate: (progress: number, time: number) => void }
const V = (x: number, y: number, z: number) => new T.Vector3(x, y, z)
const color = (hex: number) => new T.Color(hex)
let seed = 4937
const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646 }
const textureCache = new Map<string, T.CanvasTexture>()

function surface(kind: 'wood' | 'stone' | 'flour' | 'crust') {
  const cached = textureCache.get(kind)
  if (cached) return cached
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 512
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = { wood: '#b48958', stone: '#8c8a84', flour: '#f4ebd9', crust: '#c69255' }[kind]
  ctx.fillRect(0, 0, 512, 512)
  for (let i = 0; i < 15000; i++) {
    const x = random() * 512, y = random() * 512
    ctx.fillStyle = random() > 0.5 ? `rgba(255,255,255,${random() * 0.22})` : `rgba(48,28,12,${random() * 0.2})`
    ctx.fillRect(x, y, kind === 'wood' ? 12 + random() * 90 : 1 + random() * 3, 0.5 + random() * 2)
  }
  if (kind === 'wood') {
    for (let i = 0; i < 80; i++) {
      ctx.strokeStyle = `rgba(73,40,18,${0.06 + random() * 0.14})`
      ctx.beginPath()
      const y = random() * 512
      ctx.moveTo(0, y)
      ctx.bezierCurveTo(180, y - 13, 350, y + 18, 512, y + random() * 10)
      ctx.stroke()
    }
  }
  const map = new T.CanvasTexture(canvas)
  map.colorSpace = T.SRGBColorSpace
  map.wrapS = map.wrapT = T.RepeatWrapping
  map.anisotropy = 4
  textureCache.set(kind, map)
  return map
}

function mat(hex: number, kind?: Parameters<typeof surface>[0], extra: T.MeshStandardMaterialParameters = {}) {
  return new T.MeshStandardMaterial({ color: hex, roughness: 0.83, metalness: 0, ...(kind ? { map: surface(kind), bumpMap: surface(kind), bumpScale: kind === 'stone' ? 0.035 : 0.012 } : {}), ...extra })
}
function mesh(g: T.BufferGeometry, m: T.Material, parent?: T.Object3D, x=0, y=0, z=0) {
  const o = new T.Mesh(g, m)
  o.position.set(x, y, z)
  o.castShadow = o.receiveShadow = true
  parent?.add(o)
  return o
}
function rod(a: T.Vector3, b: T.Vector3, radius: number, m: T.Material, parent: T.Object3D) {
  const o = mesh(new T.CylinderGeometry(radius, radius, a.distanceTo(b), 10), m, parent)
  o.position.copy(a).add(b).multiplyScalar(0.5)
  o.quaternion.setFromUnitVectors(V(0, 1, 0), b.clone().sub(a).normalize())
  return o
}
function tube(points: T.Vector3[], radius: number, m: T.Material, parent: T.Object3D) {
  return mesh(new T.TubeGeometry(new T.CatmullRomCurve3(points), 40, radius, 8, false), m, parent)
}
function ring(radius: number, thickness: number, m: T.Material, parent: T.Object3D, y: number) {
  const o = mesh(new T.TorusGeometry(radius, thickness, 8, 80), m, parent, 0, y, 0)
  o.rotation.x = Math.PI / 2
  return o
}
function roundBox(w: number, d: number, h: number, radius = 0.15) {
  const s = new T.Shape(), x=-w/2, y=-d/2, r=radius
  s.moveTo(x+r,y); s.lineTo(x+w-r,y); s.quadraticCurveTo(x+w,y,x+w,y+r)
  s.lineTo(x+w,y+d-r); s.quadraticCurveTo(x+w,y+d,x+w-r,y+d)
  s.lineTo(x+r,y+d); s.quadraticCurveTo(x,y+d,x,y+d-r)
  s.lineTo(x,y+r); s.quadraticCurveTo(x,y,x+r,y)
  const g = new T.ExtrudeGeometry(s,{depth:h,bevelEnabled:true,bevelSegments:3,bevelSize:0.025,bevelThickness:0.025,curveSegments:10})
  g.rotateX(-Math.PI/2)
  return g
}
function board(parent: T.Object3D, w=3.8, d=2.65) {
  return mesh(roundBox(w,d,0.13),mat(0xf0d1a0,'wood'),parent,0,-0.16,0)
}
function dust(parent: T.Object3D, count=280, radius=1.3, y=0.006) {
  const geo = new T.CircleGeometry(0.013,6)
  geo.rotateX(-Math.PI/2)
  const o = new T.InstancedMesh(geo,mat(0xf0e7d3),count)
  const dummy = new T.Object3D()
  for(let i=0;i<count;i++) {
    const a=random()*Math.PI*2, r=Math.sqrt(random())*radius
    dummy.position.set(Math.cos(a)*r,y,Math.sin(a)*r*0.66)
    dummy.scale.setScalar(0.4+random()*1.9); dummy.updateMatrix(); o.setMatrixAt(i,dummy.matrix)
  }
  parent.add(o)
}
function bowl(parent: T.Object3D, hex=0xede6d9, scale=1) {
  const points = [[0,0.03],[0.45,0.03],[0.68,0.12],[0.9,0.33],[1.06,0.65],[1.12,0.96],[1.1,1.0],[1.045,1.0],[1.01,0.67],[0.85,0.36],[0.64,0.19],[0.4,0.12],[0,0.12]]
  const o = mesh(new T.LatheGeometry(points.map(([x,y])=>new T.Vector2(x,y)),80),mat(hex,undefined,{roughness:0.35}),parent)
  o.scale.setScalar(scale)
  return o
}

function doughGeometry(w=1.03,h=0.57,d=0.85) {
  const g = new T.SphereGeometry(1,64,40), p=g.attributes.position
  for(let i=0;i<p.count;i++) {
    const x=p.getX(i), y=p.getY(i), z=p.getZ(i)
    const ripple=1+0.016*Math.sin(x*12+z*5)*Math.sin(z*9+y*6)
    p.setXYZ(i,x*w*ripple,Math.max(0.025,y*h+h*0.77),z*d*ripple)
  }
  g.computeVertexNormals(); return g
}
function dough(parent: T.Object3D,w=1.03,h=0.57,d=0.85) {
  return mesh(doughGeometry(w,h,d),mat(0xfff3db,'flour',{roughness:0.9}),parent)
}

// Score channels are carved into the surface, rather than bars floating above it.
function bread(parent: T.Object3D, scale=1) {
  const g = new T.SphereGeometry(1,112,72), p=g.attributes.position
  const colors: number[]=[]
  for(let i=0;i<p.count;i++) {
    const sx=p.getX(i), sy=p.getY(i), sz=p.getZ(i)
    const x=sx*1.38, z=sz*0.78
    let y=Math.max(0.045,0.53+sy*0.66)
    const nearest=Math.min(...[-0.72,-0.24,0.24,0.72].map(c=>Math.abs(x+z*0.33-c)))
    const cut = sy>0.35 && Math.abs(z)<0.7 ? Math.exp(-Math.pow(nearest/0.066,4)) * Math.min(1,(sy-0.35)*8) : 0
    y-=cut*0.095
    y+=0.008*Math.sin(x*43)*Math.sin(z*29)
    p.setXYZ(i,x,y,z)
    const c = color(0xb86928).lerp(color(0xe9b566),Math.max(0,sy)*0.5)
    if(cut>0.05) c.lerp(color(0xf2d5a0),cut*0.9)
    const flour = Math.sin(x*18+z*7)*Math.sin(z*15-x*11)>0.57 && sy>0.15
    if(flour) c.lerp(color(0xf0dec0),0.46)
    c.multiplyScalar(0.92+0.12*Math.sin(x*117+z*71+sy*57))
    colors.push(c.r,c.g,c.b)
  }
  g.setAttribute('color',new T.Float32BufferAttribute(colors,3)); g.computeVertexNormals()
  const o=mesh(g,mat(0xffffff,undefined,{vertexColors:true,roughness:0.88}),parent)
  o.scale.setScalar(scale); return o
}

function wheatEar(parent: T.Object3D, height=2.8) {
  const ear = new T.Group(); parent.add(ear)
  const stemMat=mat(0xba913f), kernelMat=mat(0xe8bb62)
  rod(V(0,0,0),V(0.035,height,0),0.013,stemMat,ear)
  const g = new T.SphereGeometry(1,12,10)
  for(let row=0;row<9;row++) for(const side of [-1,1]) {
    const y=height-0.88+row*0.095
    const k=mesh(g,kernelMat,ear,side*(0.062-row*0.003),y,0)
    k.scale.set(0.061-row*0.0018,0.112-row*0.003,0.064)
    k.rotation.z=side*-0.43
    rod(V(side*0.085,y+0.045,0),V(side*(0.21-row*0.005),y+0.39,0),0.003,stemMat,ear)
  }
  tube([V(0,0.78,0),V(-0.19,1.12,0.06),V(-0.31,1.43,0.03)],0.017,stemMat,ear)
  return ear
}

function grainKernel(parent: T.Object3D, scale = 1) {
  // A wheat kernel has a tapered, pointed profile and a single longitudinal
  // crease. The profile keeps this from reading as a generic sphere or bun.
  const profile = [
    [0.012, -0.62], [0.12, -0.54], [0.2, -0.3], [0.21, 0],
    [0.18, 0.29], [0.1, 0.51], [0.012, 0.62],
  ]
  const group = new T.Group()
  parent.add(group)
  const seed = mesh(
    new T.LatheGeometry(profile.map(([radius, y]) => new T.Vector2(radius, y)), 48),
    mat(0xd9a84c, undefined, { roughness: 0.72 }),
    group,
  )
  seed.scale.setScalar(scale)
  const crease = tube(
    [V(0, -0.45, 0.19), V(0, -0.16, 0.21), V(0, 0.16, 0.21), V(0, 0.45, 0.19)],
    0.014,
    mat(0x8f5d24, undefined, { roughness: 0.9 }),
    group,
  )
  crease.scale.setScalar(scale)
  return group
}

function wheatChapter(): ChapterModel {
  const group=new T.Group(), ears: T.Group[]=[]
  // Golden crop silhouettes are actual ears, with kernel pairs and fine awns.
  for(let i=0;i<26;i++) {
    const ear=wheatEar(group,1.5+random()*0.55)
    ear.position.set((random()-0.5)*5.1,-0.02,-0.9-random()*2.0)
    ears.push(ear)
  }
  const hero=wheatEar(group,2.75); hero.position.set(-0.2,0,0.45); ears.push(hero)
  const second=wheatEar(group,2.35); second.position.set(0.39,0,-0.03); second.rotation.z=-0.13; ears.push(second)
  return {group,animate:(_,time)=>ears.forEach((e,i)=>e.rotation.z=Math.sin(time*0.7+i)*0.035+(i===27?-0.13:0))}
}

function grainChapter(): ChapterModel {
  const group=new T.Group(); board(group); dust(group,75)
  const kernels=new T.Group(); group.add(kernels)
  const hero = grainKernel(kernels, 1.12)
  hero.position.set(0, 0.27, 0.02)
  hero.rotation.z = Math.PI / 2 - 0.12
  for (let i = 0; i < 5; i++) {
    const seedGroup = grainKernel(kernels, 0.43 + (i % 2) * 0.06)
    seedGroup.position.set(-1.02 + i * 0.5, 0.12 + (i % 2) * 0.02, -0.72 + (i % 3) * 0.1)
    seedGroup.rotation.z = Math.PI / 2 + (i - 2) * 0.18
  }
  return {group,animate:()=>{}}
}

function millingChapter(): ChapterModel {
  const group=new T.Group(); board(group,3.8,3.0)
  const stone=mat(0xc2c0b9,'stone'), wood=mat(0xb68b50,'wood'), iron=mat(0x393b39,undefined,{metalness:0.65,roughness:0.45})
  mesh(new T.CylinderGeometry(1.18,1.22,0.35,80),stone,group,0,0.2,0)
  const rotor=new T.Group(); group.add(rotor); rotor.position.y=0.63
  mesh(new T.CylinderGeometry(1.17,1.18,0.42,80),stone,rotor)
  ring(1.18,0.016,iron,rotor,-0.19)
  for(let i=0;i<16;i++) {
    const a=i/16*Math.PI*2
    rod(V(Math.cos(a)*0.31,0.214,Math.sin(a)*0.31),V(Math.cos(a+0.23)*1.1,0.214,Math.sin(a+0.23)*1.1),0.009,mat(0x5d5b54),rotor)
  }
  rod(V(0,0.72,0),V(0,1.1,0),0.065,iron,group)
  rod(V(0,1.08,0),V(0.8,1.08,0),0.048,iron,rotor)
  rod(V(0.8,1.06,0),V(0.8,1.43,0),0.085,wood,rotor)
  // Open wooden funnel above the feed hole, supported by a small wooden bridge.
  const funnel=mesh(new T.CylinderGeometry(0.47,0.13,0.55,4,1,true),mat(0xc79451,'wood',{side:T.DoubleSide}),group,0,1.32,0)
  funnel.rotation.y=Math.PI/4
  mesh(new T.CylinderGeometry(0.26,0.26,0.025,32),mat(0xd7a556),group,0,1.47,0)
  const outlet=mesh(roundBox(0.38,0.8,0.06,0.04),wood,group,0.25,0.2,1.12); outlet.rotation.x=0.2
  const meal=mesh(doughGeometry(0.45,0.12,0.3),mat(0xf2ead7,'flour'),group,0.25,0.005,1.23)
  return {group,animate:(p,t)=>{rotor.rotation.y=t*0.25+p*4;meal.scale.setScalar(0.72+p*0.28)}}
}

function flourChapter(): ChapterModel {
  const group=new T.Group(); board(group); dust(group,600,1.55)
  const g=new T.SphereGeometry(1,80,48), p=g.attributes.position
  for(let i=0;i<p.count;i++) {
    const x=p.getX(i),z=p.getZ(i), y=p.getY(i)
    p.setXYZ(i,x*1.08,Math.max(0.012,(y+0.25)*0.43)*(1+0.04*Math.sin(x*15+z*8)),z*0.85)
  }
  g.computeVertexNormals(); mesh(g,mat(0xffffff,'flour',{roughness:1}),group,-0.2,0,0)
  const scoop=new T.Group();group.add(scoop);scoop.position.set(1,0.045,0.55);scoop.rotation.y=-0.75
  const cup=mesh(new T.SphereGeometry(0.34,40,24,0,Math.PI*2,Math.PI/2,Math.PI/2),mat(0xc29864,'wood',{side:T.DoubleSide}),scoop,0,0.25,0)
  cup.scale.set(0.8,0.7,1.35)
  rod(V(0,0.12,-0.25),V(0,0.15,-0.95),0.063,mat(0xc29864,'wood'),scoop)
  const contents=mesh(new T.CircleGeometry(0.26,48),mat(0xffffff,'flour'),scoop,0,0.2,0)
  contents.rotation.x=-Math.PI/2;contents.scale.y=1.3
  return {group,animate:()=>{}}
}

function mixingChapter(): ChapterModel {
  const group=new T.Group();board(group)
  bowl(group,0xd9e4df,0.95)
  const mix=dough(group,0.84,0.13,0.84);mix.position.y=0.53
  const spoon=new T.Group();group.add(spoon);spoon.position.y=0.72
  const wood=mat(0xbd8747,'wood')
  const spoonHead=mesh(new T.SphereGeometry(1,32,24),wood,spoon,0.48,0.01,0)
  spoonHead.scale.set(0.18,0.07,0.27)
  rod(V(0.48,0.03,0),V(0.72,1.18,0),0.045,wood,spoon)
  const jug=new T.Group();group.add(jug);jug.position.set(-1.25,1.47,-0.08);jug.rotation.z=-0.6
  const glass=mat(0xbbd9df,undefined,{transparent:true,opacity:0.4,roughness:0.16,metalness:0.15,side:T.DoubleSide,depthWrite:false})
  mesh(new T.CylinderGeometry(0.3,0.25,0.62,48,1,true),glass,jug,0,0,0)
  ring(0.3,0.019,glass,jug,0.31)
  const handle=mesh(new T.TorusGeometry(0.2,0.037,12,40),glass,jug,-0.36,0,0);handle.scale.x=0.75
  mesh(new T.CylinderGeometry(0.265,0.235,0.36,48),mat(0x8dbfc9,undefined,{transparent:true,opacity:0.58,roughness:0.15}),jug,0,-0.09,0)
  const stream=tube([V(-0.82,1.69,0),V(-0.56,1.42,0),V(-0.39,0.78,0)],0.028,mat(0xc0e1e5,undefined,{transparent:true,opacity:0.65,roughness:0.18}),group)
  return {group,animate:(p,t)=>{spoon.rotation.y=p*6+t*0.35;mix.rotation.y=p*1.5;stream.visible=p<0.74;jug.rotation.z=-0.6+(p>0.74?(p-0.74)*1.7:0)}}
}

function doughChapter(): ChapterModel {
  const group=new T.Group();board(group);dust(group,480,1.5)
  const base=dough(group,1.0,0.33,0.79)
  const fold=dough(group,0.91,0.23,0.44);fold.position.set(0,0.33,-0.19);fold.rotation.x=-0.15
  // A folded lip and a continuous crease make this read as soft kneaded dough.
  tube([V(-0.75,0.4,0.24),V(-0.3,0.37,0.32),V(0.34,0.39,0.29),V(0.78,0.33,0.16)],0.014,mat(0xcabb9e),group)
  const pin=new T.Group();group.add(pin);pin.position.set(0.2,0.7,0.58);pin.rotation.y=0.18
  const m=mat(0xdebd86,'wood');rod(V(-0.8,0,0),V(0.8,0,0),0.14,m,pin)
  rod(V(-1.13,0,0),V(1.13,0,0),0.065,m,pin)
  return {group,animate:(p)=>{fold.scale.z=0.8+p*0.3;base.scale.y=1-0.08*Math.sin(p*Math.PI)}}
}

function proofChapter(): ChapterModel {
  const group=new T.Group();board(group)
  const wicker=mat(0xd2ac76,'wood')
  const basket=new T.Group();group.add(basket)
  for(let i=0;i<13;i++) ring(0.77+i*0.024,0.031,wicker,basket,0.05+i*0.035)
  for(let i=0;i<32;i++) {
    const a=i/32*Math.PI*2
    rod(V(Math.cos(a)*0.79,0.055,Math.sin(a)*0.79),V(Math.cos(a)*1.064,0.48,Math.sin(a)*1.064),0.009,mat(0x96734b),basket)
  }
  const risen=dough(group,0.96,0.55,0.96);risen.position.y=0.18
  return {group,animate:(p)=>{risen.scale.set(0.84+p*0.13,0.68+p*0.45,0.84+p*0.13)}}
}

function ovenChapter(): ChapterModel {
  const group=new T.Group()
  const brick=mat(0xac7860,'stone'), mortar=mat(0x50443c), dark=mat(0x16100d)
  mesh(roundBox(3.8,2.65,0.18),mortar,group,0,-0.18,0)
  mesh(new T.BoxGeometry(3.5,2.1,0.2),dark,group,0,1.0,-0.8)
  mesh(new T.BoxGeometry(0.55,1.2,1.55),mortar,group,-1.47,0.6,-0.12)
  mesh(new T.BoxGeometry(0.55,1.2,1.55),mortar,group,1.47,0.6,-0.12)
  for(const side of [-1,1]) for(let row=0;row<4;row++) mesh(new T.BoxGeometry(0.51,0.275,0.22),brick,group,side*1.47,0.16+row*0.3,0.69)
  for(let i=0;i<13;i++) {
    const a=i/12*Math.PI
    const b=mesh(new T.BoxGeometry(0.315,0.53,1.52),brick,group,Math.cos(a)*1.46,1.17+Math.sin(a)*1.05,-0.12)
    b.rotation.z=a-Math.PI/2
  }
  mesh(new T.BoxGeometry(2.45,0.12,1.5),mat(0x8e7660,'stone'),group,0,0.04,0.01)
  const baked=bread(group,0.67);baked.position.set(0,0.11,0.28)
  const ember=mat(0xcf4f16,undefined,{emissive:0xff4b0a,emissiveIntensity:2.0})
  for(let i=0;i<12;i++) { const coal=mesh(new T.SphereGeometry(0.055,12,8),ember,group,(i-5.5)*0.17,0.19,-0.48);coal.scale.y=0.5 }
  const glow=new T.PointLight(0xff9b45,5,5,2);glow.position.set(0,0.75,0.1);group.add(glow)
  return {group,animate:(p,t)=>{baked.scale.setScalar(0.64+p*0.045);glow.intensity=4.3+Math.sin(t*2)*0.2}}
}

function breadChapter(): ChapterModel {
  const group=new T.Group();board(group,4.25,2.8);dust(group,70,1.65)
  const loaf=bread(group);loaf.position.set(-0.38,0.02,-0.05);loaf.rotation.y=-0.12
  const slice=new T.Group();group.add(slice);slice.position.set(1.37,0.055,0.53);slice.rotation.set(-Math.PI/2,0,0.23)
  const crust=mesh(new T.CylinderGeometry(0.66,0.65,0.16,64),mat(0xae682e,'crust'),slice)
  crust.scale.z=0.78
  const crumb=mesh(new T.CircleGeometry(0.595,64),mat(0xffe5b5,'flour'),slice,0,0.087,0)
  crumb.rotation.x=-Math.PI/2;crumb.scale.y=0.78
  for(let i=0;i<37;i++) {
    const a=random()*Math.PI*2,r=Math.sqrt(random())*0.51
    const hole=mesh(new T.CircleGeometry(0.015+random()*0.04,14),mat(0xad865a),slice,Math.cos(a)*r,0.09,Math.sin(a)*r*0.78)
    hole.rotation.x=-Math.PI/2;hole.scale.y=0.65+random()*0.8;hole.castShadow=false
  }
  // Lay the slice on the board; the crumb face remains visible from the overhead camera.
  slice.rotation.set(0,0.23,0);slice.position.y=0.12
  return {group,animate:()=>{}}
}

export function createChapters(): ChapterModel[] {
  return [wheatChapter(),grainChapter(),millingChapter(),flourChapter(),mixingChapter(),doughChapter(),proofChapter(),ovenChapter(),breadChapter()]
}
