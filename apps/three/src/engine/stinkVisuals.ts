import * as THREE from 'three'
import { CELL_COUNT, GRID, MAX_STINK_PARTICLES, type StinkSystem } from '@toot/sim-core'

const DUMMY = new THREE.Object3D()
const TMP_COLOR = new THREE.Color()

/**
 * 臭氣視覺層（低 Draw Call）：
 * - 粒子雲：1 個 InstancedMesh（1 Draw Call）
 * - 3D 格子熱力圖：1 個 InstancedMesh（1 Draw Call，可開關）
 */
export class StinkVisuals {
  readonly group = new THREE.Group()
  private readonly particleMesh: THREE.InstancedMesh
  private readonly heatmapMesh: THREE.InstancedMesh
  private lastParticleCount = -1
  private lastHeatmapCount = -1

  constructor() {
    // 1. 柔和黃綠色臭氣雲粒子（一開始就大顆蓬鬆）
    const particleGeo = new THREE.SphereGeometry(0.28, 8, 6)
    const particleMat = new THREE.MeshBasicMaterial({
      color: 0xa3e635,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    })
    this.particleMesh = new THREE.InstancedMesh(particleGeo, particleMat, MAX_STINK_PARTICLES)
    this.particleMesh.count = 0
    this.particleMesh.frustumCulled = false
    this.group.add(this.particleMesh)

    // 2. 3D 格子密度熱力圖（供工程師模式 / 除錯觀察）
    const cellGeo = new THREE.BoxGeometry(0.92, 0.92, 0.92)
    const cellMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
    })
    this.heatmapMesh = new THREE.InstancedMesh(cellGeo, cellMat, CELL_COUNT)
    this.heatmapMesh.count = 0
    this.heatmapMesh.visible = false
    this.heatmapMesh.frustumCulled = false
    this.group.add(this.heatmapMesh)
  }

  setHeatmapVisible(visible: boolean): void {
    this.heatmapMesh.visible = visible
  }

  update(stink: StinkSystem): void {
    // 更新粒子 InstancedMesh
    let pCount = 0
    for (let i = 0; i < stink.capacity; i++) {
      if (stink.alive[i] === 0) continue

      const lifeRatio = (stink.age[i] ?? 0) / Math.max(0.01, stink.maxAge[i] ?? 1)
      // 一開始就維持較大尺寸，中段微幅膨脹，最後 28% 平滑縮小淡出
      let scale = 1.15
      if (lifeRatio < 0.08) {
        scale = 0.9 + (lifeRatio / 0.08) * 0.35
      } else if (lifeRatio > 0.72) {
        scale = Math.max(0.05, ((1 - lifeRatio) / 0.28) * 1.3)
      } else {
        scale = 1.25 + lifeRatio * 0.2
      }

      DUMMY.position.set(stink.posX[i] ?? 0, stink.posY[i] ?? 0, stink.posZ[i] ?? 0)
      DUMMY.scale.setScalar(scale)
      DUMMY.updateMatrix()
      this.particleMesh.setMatrixAt(pCount, DUMMY.matrix)
      pCount++
    }
    this.particleMesh.count = pCount
    if (pCount > 0 || this.lastParticleCount !== 0) {
      this.particleMesh.instanceMatrix.needsUpdate = true
      this.lastParticleCount = pCount
    }

    // 僅在熱力圖開啟時更新格子 InstancedMesh
    if (!this.heatmapMesh.visible) return

    let cCount = 0
    const counts = stink.cellCounts
    for (let z = 0; z < GRID.NZ; z++) {
      for (let y = 0; y < GRID.NY; y++) {
        for (let x = 0; x < GRID.NX; x++) {
          const idx = x + GRID.NX * (y + GRID.NY * z)
          const n = counts[idx] ?? 0
          if (n === 0) continue

          DUMMY.position.set(x + 0.5, y + 0.5, z + 0.5)
          DUMMY.scale.setScalar(1)
          DUMMY.updateMatrix()
          this.heatmapMesh.setMatrixAt(cCount, DUMMY.matrix)

          // 濃度色階：綠 (0.33) → 黃 (0.16) → 紅 (0.0)
          const t = Math.min(1, n / 12)
          TMP_COLOR.setHSL((1 - t) * 0.33, 0.9, 0.52)
          this.heatmapMesh.setColorAt(cCount, TMP_COLOR)
          cCount++
        }
      }
    }
    this.heatmapMesh.count = cCount
    if (cCount > 0 || this.lastHeatmapCount !== 0) {
      this.heatmapMesh.instanceMatrix.needsUpdate = true
      if (this.heatmapMesh.instanceColor) {
        this.heatmapMesh.instanceColor.needsUpdate = true
      }
      this.lastHeatmapCount = cCount
    }
  }

  dispose(): void {
    this.particleMesh.geometry.dispose()
      ; (this.particleMesh.material as THREE.Material).dispose()
    this.heatmapMesh.geometry.dispose()
      ; (this.heatmapMesh.material as THREE.Material).dispose()
  }
}
