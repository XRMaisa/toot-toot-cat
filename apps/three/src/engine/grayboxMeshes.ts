import * as THREE from 'three'
import { ENTITY_SPECS, type EntityKind, type GridEntity } from '@toot/sim-core'

const ENTITY_COLORS: Record<EntityKind, number> = {
  cat: 0xffa94d,
  human: 0x60a5fa,
  bed: 0x818cf8,
  desk: 0xb45309,
  chair: 0x2dd4bf,
}

const EDGE_MATERIAL = new THREE.LineBasicMaterial({
  color: 0x1e293b,
  transparent: true,
  opacity: 0.45,
})

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

  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), EDGE_MATERIAL)
  edges.position.copy(mesh.position)
  group.add(edges)
}

/** 依 sim-core 的 GridEntity 建立對應的灰盒 Three.js 物件（原點對齊格子最小角） */
export function createGrayboxMesh(entity: GridEntity): THREE.Group {
  const group = new THREE.Group()
  group.name = `${entity.kind}#${entity.id}`
  group.userData.entityId = entity.id
  group.position.set(entity.origin.x, entity.origin.y, entity.origin.z)

  const color = ENTITY_COLORS[entity.kind]
  const { x: sx, y: sy, z: sz } = ENTITY_SPECS[entity.kind].size

  if (entity.kind === 'cat') {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.46, 24, 16),
      new THREE.MeshStandardMaterial({ color, roughness: 0.6 }),
    )
    mesh.position.set(0.5, 0.46, 0.5)
    mesh.castShadow = true
    mesh.receiveShadow = true
    group.add(mesh)
  } else if (entity.kind === 'human') {
    const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.65 })
    const headMat = new THREE.MeshStandardMaterial({ color: 0xfde68a, roughness: 0.6 })

    // 下方兩格（y = 0 ~ 2）：橢圓身體
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.45, 24, 16), bodyMat)
    body.scale.set(0.88, 2.22, 0.88)
    body.position.set(0.5, 1.0, 0.5)
    body.castShadow = true
    body.receiveShadow = true
    group.add(body)

    // 最上方一格（y = 2 ~ 3）：圓形頭部
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.42, 24, 16), headMat)
    head.position.set(0.5, 2.5, 0.5)
    head.castShadow = true
    head.receiveShadow = true
    group.add(head)
  } else {
    addBoxWithEdges(group, sx, sy, sz, color)
  }

  return group
}
