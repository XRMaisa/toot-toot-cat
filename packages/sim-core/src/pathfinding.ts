import { GRID, isInBounds } from './constants'
import type { OccupancyGrid } from './occupancy'

export interface GridXZ {
  readonly x: number
  readonly z: number
}

/** 判斷地板 (x, z) 是否可讓站立的人類（1×1×3）通行（忽略貓咪與人類本身，僅檢查家具） */
export function isFloorWalkableForHuman(
  grid: OccupancyGrid,
  x: number,
  z: number,
  humanId: number,
  catId: number,
): boolean {
  if (!isInBounds(x, 0, z)) return false
  for (let y = 0; y < 3; y++) {
    const id = grid.getCell(x, y, z)
    if (id !== 0 && id !== humanId && id !== catId) return false
  }
  return true
}

const DIRS: readonly GridXZ[] = [
  { x: 1, z: 0 },
  { x: -1, z: 0 },
  { x: 0, z: 1 },
  { x: 0, z: -1 },
]

/**
 * 16×16 地板上的 4 方向 A* 尋路。
 * 回傳從起點下一格到終點的格子陣列（不含起點）；找不到路時回傳 null。
 */
export function findFloorPath(
  grid: OccupancyGrid,
  start: GridXZ,
  goal: GridXZ,
  humanId: number,
  catId: number,
): GridXZ[] | null {
  if (start.x === goal.x && start.z === goal.z) return []
  if (!isFloorWalkableForHuman(grid, goal.x, goal.z, humanId, catId)) return null

  const total = GRID.NX * GRID.NZ
  const toKey = (x: number, z: number): number => x + z * GRID.NX

  const gScore = new Float32Array(total).fill(Infinity)
  const fScore = new Float32Array(total).fill(Infinity)
  const cameFrom = new Int32Array(total).fill(-1)
  const closed = new Uint8Array(total)

  const startKey = toKey(start.x, start.z)
  const goalKey = toKey(goal.x, goal.z)
  gScore[startKey] = 0
  fScore[startKey] = Math.abs(goal.x - start.x) + Math.abs(goal.z - start.z)

  const open: number[] = [startKey]

  while (open.length > 0) {
    // 16×16 最多 256 格，線性找最小 fScore 簡單且極快
    let bestIdx = 0
    let bestF = fScore[open[0] ?? 0] ?? Infinity
    for (let i = 1; i < open.length; i++) {
      const f = fScore[open[i] ?? 0] ?? Infinity
      if (f < bestF) {
        bestF = f
        bestIdx = i
      }
    }

    const current = open[bestIdx] ?? 0
    open.splice(bestIdx, 1)

    if (current === goalKey) {
      const path: GridXZ[] = []
      let cur = goalKey
      while (cur !== startKey && cur >= 0) {
        path.push({ x: cur % GRID.NX, z: Math.floor(cur / GRID.NX) })
        cur = cameFrom[cur] ?? -1
      }
      path.reverse()
      return path
    }

    closed[current] = 1
    const cx = current % GRID.NX
    const cz = Math.floor(current / GRID.NX)
    const curG = gScore[current] ?? Infinity

    for (const d of DIRS) {
      const nx = cx + d.x
      const nz = cz + d.z
      if (!isFloorWalkableForHuman(grid, nx, nz, humanId, catId)) continue

      const nKey = toKey(nx, nz)
      if (closed[nKey] === 1) continue

      const tentativeG = curG + 1
      if (tentativeG < (gScore[nKey] ?? Infinity)) {
        cameFrom[nKey] = current
        gScore[nKey] = tentativeG
        fScore[nKey] = tentativeG + Math.abs(goal.x - nx) + Math.abs(goal.z - nz)
        if (!open.includes(nKey)) open.push(nKey)
      }
    }
  }

  return null
}
