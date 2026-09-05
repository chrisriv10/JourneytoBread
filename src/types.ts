import type * as THREE from 'three'

export type JourneyStage =
  | 'wheat'
  | 'grain'
  | 'milling'
  | 'flour'
  | 'mixing'
  | 'dough'
  | 'proofing'
  | 'oven'
  | 'bread'

export type PointerState = {
  x: number
  y: number
  targetX: number
  targetY: number
}

export type QualityConfig = {
  mobile: boolean
  reducedMotion: boolean
  dpr: number
  wheatCount: number
  flourCount: number
  crumbCount: number
  bloom: boolean
  shadows: boolean
}

export type RenderContext = {
  progress: number
  time: number
  delta: number
  pointer: PointerState
  quality: QualityConfig
}

export type JourneyState = {
  progress: number
  stageIndex: number
  stageLabel: string
  remainingSeconds: number
}

export type JourneyWorldLike = {
  setProgress(progress: number): JourneyState
}

export type SceneModule = {
  id: JourneyStage
  mount(world: JourneyWorldLike): void
  apply(localProgress: number, context: RenderContext): void
  dispose(): void
}

export type StageDefinition = {
  id: JourneyStage
  label: string
  start: number
  end: number
}

export const STAGES: StageDefinition[] = [
  { id: 'wheat', label: 'WHEAT', start: 0, end: 0.16 },
  { id: 'grain', label: 'GRAIN', start: 0.12, end: 0.25 },
  { id: 'milling', label: 'MILLING', start: 0.21, end: 0.36 },
  { id: 'flour', label: 'FLOUR', start: 0.32, end: 0.47 },
  { id: 'mixing', label: 'MIXING', start: 0.43, end: 0.6 },
  { id: 'dough', label: 'DOUGH', start: 0.56, end: 0.72 },
  { id: 'proofing', label: 'PROOFING', start: 0.68, end: 0.82 },
  { id: 'oven', label: 'OVEN', start: 0.78, end: 0.94 },
  { id: 'bread', label: 'BREAD', start: 0.9, end: 1 },
]

export type MeshWithMaterial = THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>
