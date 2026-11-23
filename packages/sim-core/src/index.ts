/**
 * @toot/sim-core
 * 純 TypeScript、零渲染引擎依賴的模擬核心。
 * Three.js 與 Babylon.js 兩個版本共用同一份模擬，才能公平比較引擎本身的效能與除錯體驗。
 */

/** 房間實際尺寸（公尺） */
export const ROOM_SIZE = { width: 4, height: 2.5, depth: 4 } as const

/** 網格解析度（每格約 25 cm） */
export const GRID = { NX: 16, NY: 10, NZ: 16 } as const

export const CELL_COUNT = GRID.NX * GRID.NY * GRID.NZ

/** 模擬固定步長（毫秒） */
export const SIM_STEP_MS = 50

/** 人類嗅覺判定閾值（0~1） */
export const SMELL_THRESHOLD = { suspicious: 0.3, caught: 0.7 } as const

/** (x, y, z) 轉一維索引 */
export function cellIndex(x: number, y: number, z: number): number {
  return x + GRID.NX * (y + GRID.NY * z)
}

/** 最小可用的濃度網格容器（模擬邏輯下一階段再實作） */
export class StinkGrid {
  readonly concentration = new Float32Array(CELL_COUNT)
  readonly solid = new Uint8Array(CELL_COUNT)

  get(x: number, y: number, z: number): number {
    return this.concentration[cellIndex(x, y, z)] ?? 0
  }
}
