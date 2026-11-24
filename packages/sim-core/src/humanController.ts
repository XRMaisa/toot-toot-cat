import { GRID, isInBounds, type GridCoord } from './constants'
import { boxFootprint, type GridEntity, type OccupancyGrid } from './occupancy'
import { findFloorPath, isFloorWalkableForHuman, type GridXZ } from './pathfinding'
import type { Vec3 } from './catController'

export type HumanActivity = 'walk' | 'sleep' | 'computer' | 'read' | 'petCat'
export type HumanPosture = 'stand' | 'sit' | 'sleep'

export const HUMAN_ACTIVITY_LABELS: Record<HumanActivity, string> = {
  walk: '房間散步',
  sleep: '床上睡覺',
  computer: '用電腦',
  read: '靠床頭看書',
  petCat: '摸貓咪 🐱',
}

export interface HumanState {
  readonly activity: HumanActivity
  readonly posture: HumanPosture
  readonly isMoving: boolean
  /** 渲染用世界座標（站／坐時為腳底中心；睡覺時為床頭格底面中心） */
  readonly position: Readonly<Vec3>
  readonly facingYaw: number
  /** 目前頭部（鼻子）所在的格子座標（供臭氣系統吸入判定） */
  readonly headCell: Readonly<GridCoord>
  /** 距離切換下一個行動的剩餘秒數 */
  readonly actionTimer: number
  /** 若正在摸貓，回傳貓咪應該被抱在腿上的世界座標 */
  readonly petCatHoldPos: Readonly<Vec3> | null
  /** 若摸貓剛結束，回傳要放置貓咪的目標格子（左或右側） */
  readonly releaseCatCell: Readonly<GridCoord> | null
}

const STAND_FOOTPRINT = boxFootprint(1, 3, 1)
const SIT_FOOTPRINT = boxFootprint(1, 2, 1)
const SLEEP_FOOTPRINT = boxFootprint(1, 1, 3)

const HUMAN_WALK_SPEED = 2.6
const ACTIVITY_DURATION = 5.0
const PET_CAT_DURATION = 1.0
const PET_COOLDOWN = 2.0

interface ActivityTarget {
  readonly activity: Exclude<HumanActivity, 'petCat'>
  readonly approachCell: GridXZ
  readonly interactOrigin: GridCoord
  readonly interactPosture: HumanPosture
  readonly interactFacingYaw: number
}

/**
 * 人類 AI 狀態機（引擎無關）：
 * - 每 5 秒隨機切換行動（走動 / 睡覺 / 用電腦 / 靠床頭看書，不與上一個重複）
 * - 使用 A* 在地板找路
 * - 走路遇到貓擋路時原地坐下摸貓 1 秒，結束後把貓放在人的左邊或右邊
 */
export class HumanController {
  private activity: HumanActivity = 'walk'
  private posture: HumanPosture = 'stand'
  private isMoving = false
  private pos: Vec3
  private facingYaw = 0
  private headCell: GridCoord
  private actionTimer = 1.5 // 開場短暫停留後開始第一次行動
  private petTimer = 0
  private petCooldown = 0

  private path: GridXZ[] = []
  private currentTarget: ActivityTarget | null = null
  private returnFloorCell: GridXZ
  private resumeActivityAfterPet: Exclude<HumanActivity, 'petCat'> = 'walk'

  constructor(
    private readonly grid: OccupancyGrid,
    private readonly entity: GridEntity,
    private readonly catEntity: GridEntity,
  ) {
    this.pos = {
      x: entity.origin.x + 0.5,
      y: entity.origin.y,
      z: entity.origin.z + 0.5,
    }
    this.headCell = {
      x: entity.origin.x,
      y: entity.origin.y + 2,
      z: entity.origin.z,
    }
    this.returnFloorCell = { x: entity.origin.x, z: entity.origin.z }
  }

  getState(): HumanState {
    return {
      activity: this.activity,
      posture: this.posture,
      isMoving: this.isMoving,
      position: { ...this.pos },
      facingYaw: this.facingYaw,
      headCell: { ...this.headCell },
      actionTimer: this.actionTimer,
      petCatHoldPos: this.activity === 'petCat' ? this.computeLapPos() : null,
      releaseCatCell: null,
    }
  }

  step(catPos: Readonly<Vec3>, catGrounded: boolean, rawDt: number): HumanState {
    const dt = Math.min(Math.max(rawDt, 0), 0.05)
    let releaseCatCell: GridCoord | null = null

    if (this.petCooldown > 0) {
      this.petCooldown = Math.max(0, this.petCooldown - dt)
    }

    // 1. 正在摸貓（維持 1 秒）
    if (this.activity === 'petCat') {
      this.petTimer -= dt
      if (this.petTimer <= 0) {
        releaseCatCell = this.pickCatReleaseCell()
        this.standUpAtCurrentFloor()
        this.activity = this.resumeActivityAfterPet
        this.petCooldown = PET_COOLDOWN
      }
      return {
        ...this.getState(),
        releaseCatCell,
      }
    }

    // 2. 沿著 A* 路徑移動
    if (this.isMoving && this.path.length > 0) {
      const nextCell = this.path[0]
      if (!nextCell) {
        this.isMoving = false
      } else if (this.isCatBlocking(nextCell, catPos, catGrounded)) {
        // 被貓擋住 → 原地坐下摸貓 1 秒
        this.startPettingCat(catPos)
        return this.getState()
      } else {
        this.moveTowardCell(nextCell, dt)
      }
      return this.getState()
    }

    // 3. 抵達目標或在原地執行行動（計時 5 秒）
    this.actionTimer -= dt
    if (this.actionTimer <= 0) {
      this.pickNextActivity()
    }

    return this.getState()
  }

  private isCatBlocking(nextCell: GridXZ, catPos: Readonly<Vec3>, catGrounded: boolean): boolean {
    if (this.petCooldown > 0 || !catGrounded || catPos.y > 0.6) return false
    const catCell = this.catEntity.origin
    if (catCell.y === 0 && catCell.x === nextCell.x && catCell.z === nextCell.z) {
      return true
    }
    const dist = Math.hypot(catPos.x - (nextCell.x + 0.5), catPos.z - (nextCell.z + 0.5))
    return dist < 0.72
  }

  private startPettingCat(catPos: Readonly<Vec3>): void {
    this.resumeActivityAfterPet = this.activity === 'petCat' ? 'walk' : this.activity
    this.activity = 'petCat'
    this.posture = 'sit'
    this.isMoving = false
    this.petTimer = PET_CAT_DURATION

    // 面向貓咪坐下
    const dx = catPos.x - this.pos.x
    const dz = catPos.z - this.pos.z
    if (Math.hypot(dx, dz) > 0.05) {
      this.facingYaw = Math.atan2(dx, dz)
    }

    const hx = this.entity.origin.x
    const hz = this.entity.origin.z
    this.grid.move(this.entity.id, { x: hx, y: 0, z: hz }, SIT_FOOTPRINT)
    this.pos = { x: hx + 0.5, y: 0, z: hz + 0.5 }
    this.headCell = { x: hx, y: 1, z: hz }
  }

  private standUpAtCurrentFloor(): void {
    const hx = this.entity.origin.x
    const hz = this.entity.origin.z
    this.posture = 'stand'
    this.grid.move(this.entity.id, { x: hx, y: 0, z: hz }, STAND_FOOTPRINT)
    this.pos = { x: hx + 0.5, y: 0, z: hz + 0.5 }
    this.headCell = { x: hx, y: 2, z: hz }
    if (this.path.length > 0) {
      this.isMoving = true
    }
  }

  private computeLapPos(): Vec3 {
    const fwdX = Math.sin(this.facingYaw)
    const fwdZ = Math.cos(this.facingYaw)
    return {
      x: this.pos.x + fwdX * 0.42,
      y: 0.48,
      z: this.pos.z + fwdZ * 0.42,
    }
  }

  /** 摸完貓後把貓放到人的左邊或右邊（優先空格，兩邊都有東西就放後方） */
  private pickCatReleaseCell(): GridCoord {
    const hx = this.entity.origin.x
    const hz = this.entity.origin.z

    // 根據面向換算格子層級的右方、左方、後方
    const fwdX = Math.round(Math.sin(this.facingYaw))
    const fwdZ = Math.round(Math.cos(this.facingYaw))
    const rightX = -fwdZ || 1
    const rightZ = fwdX
    const leftX = -rightX
    const leftZ = -rightZ

    const candidates: GridXZ[] = [
      { x: hx + rightX, z: hz + rightZ },
      { x: hx + leftX, z: hz + leftZ },
      { x: hx - fwdX, z: hz - fwdZ },
      { x: hx + fwdX, z: hz + fwdZ },
      { x: hx + 1, z: hz },
      { x: hx - 1, z: hz },
      { x: hx, z: hz + 1 },
      { x: hx, z: hz - 1 },
    ]

    // 隨機微調左右優先順序，避免每次都只放同一邊
    if (Math.random() < 0.5 && candidates[0] && candidates[1]) {
      const tmp = candidates[0]
      candidates[0] = candidates[1]
      candidates[1] = tmp
    }

    for (const c of candidates) {
      if (!isInBounds(c.x, 0, c.z)) continue
      const id = this.grid.getCell(c.x, 0, c.z)
      if (id === 0 || id === this.catEntity.id) {
        return { x: c.x, y: 0, z: c.z }
      }
    }
    return { x: hx, y: 0, z: hz }
  }

  private moveTowardCell(target: GridXZ, dt: number): void {
    const tx = target.x + 0.5
    const tz = target.z + 0.5
    const dx = tx - this.pos.x
    const dz = tz - this.pos.z
    const dist = Math.hypot(dx, dz)

    if (dist > 0.01) {
      this.facingYaw = Math.atan2(dx, dz)
    }

    const stepDist = HUMAN_WALK_SPEED * dt
    if (dist <= stepDist) {
      this.pos.x = tx
      this.pos.y = 0
      this.pos.z = tz
      this.grid.move(this.entity.id, { x: target.x, y: 0, z: target.z }, STAND_FOOTPRINT)
      this.headCell = { x: target.x, y: 2, z: target.z }
      this.returnFloorCell = { x: target.x, z: target.z }
      this.path.shift()

      if (this.path.length === 0) {
        this.onArrivedAtTarget()
      }
    } else {
      this.pos.x += (dx / dist) * stepDist
      this.pos.z += (dz / dist) * stepDist
      const cx = Math.floor(this.pos.x)
      const cz = Math.floor(this.pos.z)
      if (cx !== this.entity.origin.x || cz !== this.entity.origin.z) {
        this.grid.move(this.entity.id, { x: cx, y: 0, z: cz }, STAND_FOOTPRINT)
        this.headCell = { x: cx, y: 2, z: cz }
      }
    }
  }

  private onArrivedAtTarget(): void {
    this.isMoving = false
    this.actionTimer = ACTIVITY_DURATION

    if (!this.currentTarget) return

    const { activity, interactOrigin, interactPosture, interactFacingYaw } = this.currentTarget
    this.activity = activity
    this.facingYaw = interactFacingYaw

    if (interactPosture === 'sleep') {
      const moved = this.grid.move(this.entity.id, interactOrigin, SLEEP_FOOTPRINT)
      if (moved) {
        this.posture = 'sleep'
        this.pos = {
          x: interactOrigin.x + 0.5,
          y: interactOrigin.y,
          z: interactOrigin.z + 0.5,
        }
        // 躺在床頭那格（y=1）
        this.headCell = { x: interactOrigin.x, y: interactOrigin.y, z: interactOrigin.z }
        return
      }
    } else if (interactPosture === 'sit') {
      const moved = this.grid.move(this.entity.id, interactOrigin, SIT_FOOTPRINT)
      if (moved) {
        this.posture = 'sit'
        this.pos = {
          x: interactOrigin.x + 0.5,
          y: interactOrigin.y,
          z: interactOrigin.z + 0.5,
        }
        // 坐姿（佔 y 和 y+1），頭在 y+1（在床/椅子上時為 y=2）
        this.headCell = { x: interactOrigin.x, y: interactOrigin.y + 1, z: interactOrigin.z }
        return
      }
    }

    // 預設站立（或家具上被貓佔住時退回站在旁邊）
    this.posture = 'stand'
    this.headCell = { x: this.entity.origin.x, y: this.entity.origin.y + 2, z: this.entity.origin.z }
  }

  private pickNextActivity(): void {
    // 如果目前在家具上（睡覺、用電腦、看書），先下家具回到地板站立
    if (this.posture !== 'stand') {
      const back = this.findNearestStandableFloor(this.returnFloorCell)
      if (back) {
        this.grid.move(this.entity.id, { x: back.x, y: 0, z: back.z }, STAND_FOOTPRINT)
        this.pos = { x: back.x + 0.5, y: 0, z: back.z + 0.5 }
        this.headCell = { x: back.x, y: 2, z: back.z }
        this.posture = 'stand'
        this.returnFloorCell = back
      }
    }

    const candidates = this.buildAvailableTargets().filter((t) => t.activity !== this.activity)
    const pool = candidates.length > 0 ? candidates : this.buildAvailableTargets()
    if (pool.length === 0) {
      this.actionTimer = ACTIVITY_DURATION
      return
    }

    const chosen = pool[Math.floor(Math.random() * pool.length)]
    if (!chosen) {
      this.actionTimer = ACTIVITY_DURATION
      return
    }

    const start: GridXZ = { x: this.entity.origin.x, z: this.entity.origin.z }
    const path = findFloorPath(
      this.grid,
      start,
      chosen.approachCell,
      this.entity.id,
      this.catEntity.id,
    )

    this.currentTarget = chosen
    this.activity = chosen.activity

    if (!path) {
      this.actionTimer = 2.0
      return
    }

    if (path.length === 0) {
      this.onArrivedAtTarget()
    } else {
      this.path = path
      this.isMoving = true
    }
  }

  private buildAvailableTargets(): ActivityTarget[] {
    const targets: ActivityTarget[] = []
    const entities = this.grid.getAllEntities()

    // 1. 隨機地板走動
    const randomFloor = this.pickRandomWalkableCell()
    if (randomFloor) {
      targets.push({
        activity: 'walk',
        approachCell: randomFloor,
        interactOrigin: { x: randomFloor.x, y: 0, z: randomFloor.z },
        interactPosture: 'stand',
        interactFacingYaw: Math.random() * Math.PI * 2,
      })
    }

    // 2. 床相關：睡覺、靠床頭看書
    const bed = entities.find((e) => e.kind === 'bed')
    if (bed) {
      const approach = this.findApproachAroundBox(bed.origin.x, bed.origin.z, 3, 3)
      if (approach) {
        targets.push({
          activity: 'sleep',
          approachCell: approach,
          interactOrigin: { x: bed.origin.x + 1, y: 1, z: bed.origin.z },
          interactPosture: 'sleep',
          interactFacingYaw: 0,
        })
        targets.push({
          activity: 'read',
          approachCell: approach,
          interactOrigin: { x: bed.origin.x + 1, y: 1, z: bed.origin.z },
          interactPosture: 'sit',
          interactFacingYaw: 0, // 靠在床頭朝床尾看書（+Z）
        })
      }
    }

    // 3. 椅子 / 書桌：坐椅子用電腦
    const chair = entities.find((e) => e.kind === 'chair')
    if (chair) {
      const approach = this.findApproachAroundBox(chair.origin.x, chair.origin.z, 1, 1)
      if (approach) {
        const desk = entities.find((e) => e.kind === 'desk')
        const facingYaw = desk
          ? Math.atan2(desk.origin.x + 0.5 - chair.origin.x, desk.origin.z - chair.origin.z)
          : Math.PI
        targets.push({
          activity: 'computer',
          approachCell: approach,
          interactOrigin: { x: chair.origin.x, y: 1, z: chair.origin.z },
          interactPosture: 'sit',
          interactFacingYaw: facingYaw,
        })
      }
    }

    return targets
  }

  private findApproachAroundBox(bx: number, bz: number, sx: number, sz: number): GridXZ | null {
    const candidates: GridXZ[] = []
    for (let x = bx; x < bx + sx; x++) {
      candidates.push({ x, z: bz + sz }, { x, z: bz - 1 })
    }
    for (let z = bz; z < bz + sz; z++) {
      candidates.push({ x: bx + sx, z }, { x: bx - 1, z })
    }
    for (const c of candidates) {
      if (isFloorWalkableForHuman(this.grid, c.x, c.z, this.entity.id, this.catEntity.id)) {
        return c
      }
    }
    return null
  }

  private findNearestStandableFloor(pref: GridXZ): GridXZ | null {
    const checks: GridXZ[] = [
      pref,
      { x: pref.x + 1, z: pref.z },
      { x: pref.x - 1, z: pref.z },
      { x: pref.x, z: pref.z + 1 },
      { x: pref.x, z: pref.z - 1 },
    ]
    for (const c of checks) {
      if (isFloorWalkableForHuman(this.grid, c.x, c.z, this.entity.id, this.catEntity.id)) {
        return c
      }
    }
    return this.pickRandomWalkableCell()
  }

  private pickRandomWalkableCell(): GridXZ | null {
    for (let tries = 0; tries < 40; tries++) {
      const x = Math.floor(Math.random() * GRID.NX)
      const z = Math.floor(Math.random() * GRID.NZ)
      if (x === this.entity.origin.x && z === this.entity.origin.z) continue
      if (isFloorWalkableForHuman(this.grid, x, z, this.entity.id, this.catEntity.id)) {
        return { x, z }
      }
    }
    return null
  }
}
