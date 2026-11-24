import * as THREE from 'three'
import {
  ENTITY_SPECS,
  type EntityKind,
  type GridEntity,
  type HumanAlertLevel,
  type HumanState,
} from '@toot/sim-core'

const ENTITY_COLORS: Record<EntityKind, number> = {
  cat: 0xffa94d,
  human: 0x60a5fa,
  bed: 0x818cf8,
  desk: 0xb45309,
  chair: 0x2dd4bf,
}

export const SHARED_EDGE_MATERIAL = new THREE.LineBasicMaterial({
  color: 0x1e293b,
  transparent: true,
  opacity: 0.45,
})

export const SHARED_GRAYBOX_MATERIALS: ReadonlySet<THREE.Material> = new Set([SHARED_EDGE_MATERIAL])

function addBoxWithEdges(
  group: THREE.Group,
  sx: number,
  sy: number,
  sz: number,
  color: number,
): void {
  const geo = new THREE.BoxGeometry(sx, sy, sz)
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.75 })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.position.set(sx / 2, sy / 2, sz / 2)
  mesh.castShadow = true
  mesh.receiveShadow = true
  group.add(mesh)

  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), SHARED_EDGE_MATERIAL)
  edges.position.copy(mesh.position)
  group.add(edges)
}

function createEmojiSpriteTexture(symbol: string, bgColor: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.beginPath()
    ctx.arc(64, 64, 54, 0, Math.PI * 2)
    ctx.fillStyle = bgColor
    ctx.fill()
    ctx.lineWidth = 6
    ctx.strokeStyle = '#ffffff'
    ctx.stroke()

    ctx.font = 'bold 64px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#ffffff'
    ctx.fillText(symbol, 64, 68)
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

export interface CatMeshRig {
  readonly group: THREE.Group
  setFarting(active: boolean): void
}

export interface HumanMeshRig {
  readonly group: THREE.Group
  setAlert(level: HumanAlertLevel): void
  updateState(state: HumanState, timeSec: number): void
  dispose(): void
}

/** 建立可旋轉與顯示放屁回饋的貓咪灰盒（原點在底面中心，面朝 +Z） */
export function createCatMesh(entity: GridEntity): CatMeshRig {
  const group = new THREE.Group()
  group.name = `cat#${entity.id}`
  group.userData.entityId = entity.id
  group.position.set(entity.origin.x + 0.5, entity.origin.y, entity.origin.z + 0.5)

  const bodyMat = new THREE.MeshStandardMaterial({
    color: ENTITY_COLORS.cat,
    roughness: 0.6,
    emissive: 0x000000,
  })

  const body = new THREE.Mesh(new THREE.SphereGeometry(0.42, 24, 16), bodyMat)
  body.position.set(0, 0.42, 0)
  body.castShadow = true
  body.receiveShadow = true
  group.add(body)

  // 小耳朵讓玩家一眼看出貓咪面向（+Z 為前方）
  const earGeo = new THREE.ConeGeometry(0.11, 0.2, 4)
  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(earGeo, bodyMat)
    ear.position.set(side * 0.2, 0.82, 0.12)
    ear.rotation.z = -side * 0.2
    ear.castShadow = true
    group.add(ear)
  }

  return {
    group,
    setFarting(active: boolean) {
      bodyMat.emissive.setHex(active ? 0x4d7c0f : 0x000000)
      body.scale.set(active ? 1.08 : 1, active ? 0.92 : 1, active ? 1.08 : 1)
    },
  }
}

/** 建立兩等身人類灰盒（原點在底面中心，支援站 / 坐 / 睡姿勢與頭頂 ❓ / 💢 標記） */
export function createHumanMesh(entity: GridEntity): HumanMeshRig {
  const group = new THREE.Group()
  group.name = `human#${entity.id}`
  group.userData.entityId = entity.id
  group.position.set(entity.origin.x + 0.5, entity.origin.y, entity.origin.z + 0.5)

  const bodyMat = new THREE.MeshStandardMaterial({ color: ENTITY_COLORS.human, roughness: 0.65 })
  const headMat = new THREE.MeshStandardMaterial({ color: 0xfde68a, roughness: 0.6 })
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.4 })

  const body = new THREE.Mesh(new THREE.SphereGeometry(0.45, 24, 16), bodyMat)
  body.scale.set(0.88, 2.22, 0.88)
  body.position.set(0, 1.0, 0)
  body.castShadow = true
  body.receiveShadow = true
  group.add(body)

  const headGroup = new THREE.Group()
  headGroup.position.set(0, 2.5, 0)
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.42, 24, 16), headMat)
  head.castShadow = true
  head.receiveShadow = true
  headGroup.add(head)

  // 兩顆小眼睛標示面向（+Z）
  const eyeGeo = new THREE.SphereGeometry(0.055, 8, 8)
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(eyeGeo, eyeMat)
    eye.position.set(side * 0.14, 0.05, 0.37)
    headGroup.add(eye)
  }
  group.add(headGroup)

  const texSuspicious = createEmojiSpriteTexture('?', '#f59e0b')
  const texCaught = createEmojiSpriteTexture('!', '#ef4444')
  const badgeMat = new THREE.SpriteMaterial({ map: texSuspicious, transparent: true })
  const badge = new THREE.Sprite(badgeMat)
  badge.position.set(0, 3.45, 0)
  badge.scale.set(0.75, 0.75, 1)
  badge.visible = false
  group.add(badge)

  let currentLevel: HumanAlertLevel = 'calm'

  return {
    group,
    setAlert(level: HumanAlertLevel) {
      if (level === currentLevel) return
      currentLevel = level
      if (level === 'calm') {
        badge.visible = false
        headMat.emissive.setHex(0x000000)
      } else if (level === 'suspicious') {
        badge.visible = true
        badgeMat.map = texSuspicious
        badgeMat.needsUpdate = true
        headMat.emissive.setHex(0x78350f)
      } else {
        badge.visible = true
        badgeMat.map = texCaught
        badgeMat.needsUpdate = true
        headMat.emissive.setHex(0x991b1b)
      }
    },
    updateState(state: HumanState, timeSec: number) {
      group.position.set(state.position.x, state.position.y, state.position.z)
      group.rotation.y = state.facingYaw

      if (state.posture === 'sleep') {
        body.rotation.set(Math.PI / 2, 0, 0)
        body.scale.set(0.88, 2.22, 0.88)
        body.position.set(0, 0.42, 1.45)
        headGroup.position.set(0, 0.46, 0.05)
        headGroup.rotation.set(-Math.PI / 2, 0, 0)
        badge.position.set(0, 1.45, 0.05)
      } else if (state.posture === 'sit') {
        const petBob = state.activity === 'petCat' ? Math.sin(timeSec * 18) * 0.05 : 0
        body.rotation.set(0, 0, 0)
        body.scale.set(0.96, 1.22, 0.96)
        body.position.set(0, 0.55, 0)
        headGroup.position.set(0, 1.48 + petBob, 0)
        headGroup.rotation.set(state.activity === 'petCat' ? 0.3 : 0, 0, 0)
        badge.position.set(0, 2.45, 0)
      } else {
        const walkBob = state.isMoving ? Math.abs(Math.sin(timeSec * 9)) * 0.08 : 0
        body.rotation.set(0, 0, 0)
        body.scale.set(0.88, 2.22, 0.88)
        body.position.set(0, 1.0 + walkBob, 0)
        headGroup.position.set(0, 2.5 + walkBob, 0)
        headGroup.rotation.set(0, 0, 0)
        badge.position.set(0, 3.45 + walkBob, 0)
      }
    },
    dispose() {
      texSuspicious.dispose()
      texCaught.dispose()
      badgeMat.dispose()
    },
  }
}

/** 依 sim-core 的 GridEntity 建立對應的灰盒家具 Three.js 物件 */
export function createGrayboxMesh(entity: GridEntity): THREE.Group {
  if (entity.kind === 'cat') return createCatMesh(entity).group
  if (entity.kind === 'human') return createHumanMesh(entity).group

  const group = new THREE.Group()
  group.name = `${entity.kind}#${entity.id}`
  group.userData.entityId = entity.id
  group.position.set(entity.origin.x, entity.origin.y, entity.origin.z)

  const color = ENTITY_COLORS[entity.kind]
  const { x: sx, y: sy, z: sz } = ENTITY_SPECS[entity.kind].size
  addBoxWithEdges(group, sx, sy, sz, color)
  return group
}
