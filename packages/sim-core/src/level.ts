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

const VALID_FURNITURE = new Set<string>(['bed', 'desk', 'chair'])

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

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v)
}

/** 解析並驗證外部匯入的關卡 JSON 字串，確保格式正確且不重疊 */
export function parseLevelJson(raw: string): LevelData {
  let obj: unknown
  try {
    obj = JSON.parse(raw)
  } catch {
    throw new Error('JSON 格式錯誤，請檢查括號與引號')
  }

  if (!obj || typeof obj !== 'object') {
    throw new Error('關卡資料必須是 JSON 物件')
  }

  const rec = obj as Record<string, unknown>
  const id = typeof rec.id === 'string' && rec.id.trim() ? rec.id.trim() : 'custom-level'
  const name = typeof rec.name === 'string' && rec.name.trim() ? rec.name.trim() : '自訂關卡'
  const fartQuota = typeof rec.fartQuota === 'number' && rec.fartQuota > 0 ? rec.fartQuota : 100
  const parTime = typeof rec.parTime === 'number' && rec.parTime > 0 ? rec.parTime : 60
  const parPresses = isInt(rec.parPresses) && rec.parPresses > 0 ? rec.parPresses : 3

  if (!Array.isArray(rec.furniture)) {
    throw new Error('缺少 furniture 陣列')
  }

  const furniture: LevelFurniturePlacement[] = rec.furniture.map((entry, idx) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`furniture[${idx}] 格式錯誤`)
    }
    const f = entry as Record<string, unknown>
    if (typeof f.type !== 'string' || !VALID_FURNITURE.has(f.type)) {
      throw new Error(`furniture[${idx}] 類型無效：${String(f.type)}`)
    }
    if (!isInt(f.x) || !isInt(f.z)) {
      throw new Error(`furniture[${idx}] 座標 x / z 必須為整數`)
    }
    return { type: f.type as FurnitureKind, x: f.x, z: f.z }
  })

  const catRec = rec.cat as Record<string, unknown> | undefined
  if (!catRec || !isInt(catRec.x) || !isInt(catRec.z)) {
    throw new Error('缺少有效的 cat 起點座標 { x, z }')
  }

  const humanRec = rec.human as Record<string, unknown> | undefined
  if (!humanRec || !isInt(humanRec.x) || !isInt(humanRec.z)) {
    throw new Error('缺少有效的 human 起點座標 { x, z }')
  }

  const parsed: LevelData = {
    id,
    name,
    fartQuota,
    parTime,
    parPresses,
    furniture,
    cat: { x: catRec.x, z: catRec.z },
    human: { x: humanRec.x, z: humanRec.z },
  }

  // 實際跑一次 loadLevel 確認沒有重疊或超出邊界
  loadLevel(parsed)
  return parsed
}

/** 序列化關卡為易讀的 JSON 字串 */
export function serializeLevelJson(data: LevelData): string {
  return JSON.stringify(data, null, 2)
}
