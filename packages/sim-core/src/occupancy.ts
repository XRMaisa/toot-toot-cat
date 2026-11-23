import { CELL_COUNT, cellIndex, isInBounds, type GridCoord } from './constants'

export type FurnitureKind = 'bed' | 'desk' | 'chair'
export type ActorKind = 'cat' | 'human'
export type EntityKind = FurnitureKind | ActorKind

/** 尺寸寫法統一：寬(X) × 深(Z) × 高(Y) */
export interface EntitySpec {
  readonly kind: EntityKind
  readonly label: string
  readonly size: { readonly x: number; readonly z: number; readonly y: number }
  /** 是否阻擋臭氣粒子（家具為 true，貓與人為 false） */
  readonly blocksSmell: boolean
}

export const ENTITY_SPECS: Record<EntityKind, EntitySpec> = {
  cat: { kind: 'cat', label: '貓咪', size: { x: 1, z: 1, y: 1 }, blocksSmell: false },
  human: { kind: 'human', label: '人類', size: { x: 1, z: 1, y: 3 }, blocksSmell: false },
  bed: { kind: 'bed', label: '床', size: { x: 3, z: 3, y: 1 }, blocksSmell: true },
  desk: { kind: 'desk', label: '書桌', size: { x: 2, z: 1, y: 3 }, blocksSmell: true },
  chair: { kind: 'chair', label: '椅子', size: { x: 1, z: 1, y: 1 }, blocksSmell: true },
}

/** 產生實心長方體的相對佔用格子清單 */
export function boxFootprint(sx: number, sy: number, sz: number): GridCoord[] {
  const cells: GridCoord[] = []
  for (let y = 0; y < sy; y++) {
    for (let z = 0; z < sz; z++) {
      for (let x = 0; x < sx; x++) {
        cells.push({ x, y, z })
      }
    }
  }
  return cells
}

export function defaultFootprint(kind: EntityKind): GridCoord[] {
  const { x, y, z } = ENTITY_SPECS[kind].size
  return boxFootprint(x, y, z)
}

export interface GridEntity {
  readonly id: number
  readonly kind: EntityKind
  origin: GridCoord
  footprint: readonly GridCoord[]
  readonly blocksSmell: boolean
}

/**
 * 16 × 10 × 16 空間佔用表。
 * 規則：每一格（1×1×1）同一時間只能有一個物件（0 代表空）。
 */
export class OccupancyGrid {
  private readonly cells = new Int32Array(CELL_COUNT)
  private readonly entities = new Map<number, GridEntity>()
  private nextId = 1

  /** 取得指定格子的 entityId；空為 0，超出邊界為 -1 */
  getCell(x: number, y: number, z: number): number {
    if (!isInBounds(x, y, z)) return -1
    return this.cells[cellIndex(x, y, z)] ?? 0
  }

  getEntity(id: number): GridEntity | undefined {
    return this.entities.get(id)
  }

  getEntityAt(x: number, y: number, z: number): GridEntity | undefined {
    const id = this.getCell(x, y, z)
    return id > 0 ? this.entities.get(id) : undefined
  }

  getAllEntities(): GridEntity[] {
    return Array.from(this.entities.values())
  }

  /** 該格是否會阻擋臭氣粒子（超出邊界或被家具佔用） */
  isSolidForSmell(x: number, y: number, z: number): boolean {
    if (!isInBounds(x, y, z)) return true
    const entity = this.getEntityAt(x, y, z)
    return entity ? entity.blocksSmell : false
  }

  /** 檢查指定位置與形狀是否可以放置（所有格子皆在範圍內且無人佔用） */
  canPlace(
    origin: GridCoord,
    footprint: readonly GridCoord[],
    ignoreEntityId = 0,
  ): boolean {
    for (const offset of footprint) {
      const cx = origin.x + offset.x
      const cy = origin.y + offset.y
      const cz = origin.z + offset.z
      if (!isInBounds(cx, cy, cz)) return false
      const existing = this.cells[cellIndex(cx, cy, cz)] ?? 0
      if (existing !== 0 && existing !== ignoreEntityId) return false
    }
    return true
  }

  /** 放置一個新物件，若衝突或超界則回傳 null */
  place(
    kind: EntityKind,
    origin: GridCoord,
    footprint: readonly GridCoord[] = defaultFootprint(kind),
  ): GridEntity | null {
    if (!this.canPlace(origin, footprint)) return null
    const id = this.nextId++
    const entity: GridEntity = {
      id,
      kind,
      origin: { ...origin },
      footprint,
      blocksSmell: ENTITY_SPECS[kind].blocksSmell,
    }
    this.writeEntity(entity, id)
    this.entities.set(id, entity)
    return entity
  }

  /** 移除指定物件 */
  remove(entityId: number): boolean {
    const entity = this.entities.get(entityId)
    if (!entity) return false
    this.writeEntity(entity, 0)
    this.entities.delete(entityId)
    return true
  }

  /** 移動既有物件（可選擇同時切換形狀，例如人站姿改躺姿） */
  move(
    entityId: number,
    newOrigin: GridCoord,
    newFootprint?: readonly GridCoord[],
  ): boolean {
    const entity = this.entities.get(entityId)
    if (!entity) return false
    const targetFootprint = newFootprint ?? entity.footprint
    if (!this.canPlace(newOrigin, targetFootprint, entityId)) return false

    this.writeEntity(entity, 0)
    entity.origin = { ...newOrigin }
    entity.footprint = targetFootprint
    this.writeEntity(entity, entityId)
    return true
  }

  /** 查詢 (x, z) 垂直柱上從低到高有哪些物件 */
  getColumnEntities(x: number, z: number): GridEntity[] {
    const seen = new Set<number>()
    const result: GridEntity[] = []
    for (let y = 0; y < 10; y++) {
      const id = this.getCell(x, y, z)
      if (id > 0 && !seen.has(id)) {
        seen.add(id)
        const entity = this.entities.get(id)
        if (entity) result.push(entity)
      }
    }
    return result
  }

  private writeEntity(entity: GridEntity, value: number): void {
    for (const offset of entity.footprint) {
      const idx = cellIndex(
        entity.origin.x + offset.x,
        entity.origin.y + offset.y,
        entity.origin.z + offset.z,
      )
      this.cells[idx] = value
    }
  }
}
