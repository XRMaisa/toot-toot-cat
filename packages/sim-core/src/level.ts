import { OccupancyGrid, type FurnitureKind, type GridEntity } from './occupancy'

export interface LevelFurniturePlacement {
  readonly type: FurnitureKind
  readonly x: number
  readonly z: number
}

export interface LevelData {
  readonly id: string
  readonly name: string
  readonly fartQuota: number
  readonly parTime: number
  readonly parPresses: number
  readonly furniture: readonly LevelFurniturePlacement[]
  readonly cat: { readonly x: number; readonly z: number }
  readonly human: { readonly x: number; readonly z: number }
}

/** 預設第一關（對應 game-design.md 草案） */
export const LEVEL_01: LevelData = {
  id: 'level-01',
  name: '灰盒測試房間',
  fartQuota: 100,
  parTime: 60,
  parPresses: 3,
  furniture: [
    { type: 'bed', x: 1, z: 1 },
    { type: 'desk', x: 12, z: 1 },
    { type: 'chair', x: 12, z: 2 },
  ],
  cat: { x: 8, z: 8 },
  human: { x: 6, z: 10 },
}

export interface LoadedLevel {
  readonly data: LevelData
  readonly grid: OccupancyGrid
  readonly cat: GridEntity
  readonly human: GridEntity
  readonly furniture: readonly GridEntity[]
}

/** 依關卡 JSON 建立空間佔用表並驗證所有物件不重疊、不超界 */
export function loadLevel(data: LevelData): LoadedLevel {
  const grid = new OccupancyGrid()
  const furniture: GridEntity[] = []

  for (const item of data.furniture) {
    const placed = grid.place(item.type, { x: item.x, y: 0, z: item.z })
    if (!placed) {
      throw new Error(`無法放置家具 ${item.type} 於 (${item.x}, 0, ${item.z})：超出邊界或與其他物件重疊`)
    }
    furniture.push(placed)
  }

  const cat = grid.place('cat', { x: data.cat.x, y: 0, z: data.cat.z })
  if (!cat) {
    throw new Error(`無法放置貓咪於 (${data.cat.x}, 0, ${data.cat.z})：超出邊界或與其他物件重疊`)
  }

  const human = grid.place('human', { x: data.human.x, y: 0, z: data.human.z })
  if (!human) {
    throw new Error(`無法放置人類於 (${data.human.x}, 0, ${data.human.z})：超出邊界或與其他物件重疊`)
  }

  return { data, grid, cat, human, furniture }
}
