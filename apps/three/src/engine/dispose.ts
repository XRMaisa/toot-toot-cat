import * as THREE from 'three'

/**
 * 遞迴釋放 Object3D 樹下所有 Mesh / LineSegments / Sprite 的 geometry 與 material，
 * 避免重玩關卡或編輯器頻繁增刪家具時造成 WebGL 顯存洩漏。
 */
export function disposeObject3D(
  root: THREE.Object3D,
  sharedMaterials?: ReadonlySet<THREE.Material>,
): void {
  const disposedGeos = new Set<THREE.BufferGeometry>()
  const disposedMats = new Set<THREE.Material>()

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh | THREE.LineSegments | THREE.Sprite
    if (mesh.geometry && !disposedGeos.has(mesh.geometry)) {
      mesh.geometry.dispose()
      disposedGeos.add(mesh.geometry)
    }
    const mat = mesh.material
    if (!mat) return
    const mats = Array.isArray(mat) ? mat : [mat]
    for (const m of mats) {
      if (sharedMaterials?.has(m) || disposedMats.has(m)) continue
      m.dispose()
      disposedMats.add(m)
    }
  })
}
