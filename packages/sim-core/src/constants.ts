/** 房間格子解析度（1 格 = 1 單位正方形） */
export const GRID = { NX: 16, NY: 10, NZ: 16 } as const

/** 房間世界尺寸（與格數 1:1 對應） */
export const ROOM_SIZE = {
  width: GRID.NX,
  height: GRID.NY,
  depth: GRID.NZ,
} as const

export const CELL_COUNT = GRID.NX * GRID.NY * GRID.NZ

/** 模擬固定步長（毫秒） */
export const SIM_STEP_MS = 50

/** 人類懷疑值判定門檻（0 ~ 100） */
export const SUSPICION_THRESHOLD = { suspicious: 30, caught: 70 } as const

export interface GridCoord {
  readonly x: number
  readonly y: number
  readonly z: number
}

/** (x, y, z) 轉一維陣列索引 */
export function cellIndex(x: number, y: number, z: number): number {
  return x + GRID.NX * (y + GRID.NY * z)
}

/** 檢查格子座標是否在房間範圍內 */
export function isInBounds(x: number, y: number, z: number): boolean {
  return (
    x >= 0 &&
    x < GRID.NX &&
    y >= 0 &&
    y < GRID.NY &&
    z >= 0 &&
    z < GRID.NZ
  )
}

/** 格子座標轉為該格中心點的世界座標 */
export function cellToWorldCenter(x: number, y: number, z: number): GridCoord {
  return { x: x + 0.5, y: y + 0.5, z: z + 0.5 }
}

/** 世界座標轉為所屬格子座標 */
export function worldToCell(wx: number, wy: number, wz: number): GridCoord {
  return { x: Math.floor(wx), y: Math.floor(wy), z: Math.floor(wz) }
}
