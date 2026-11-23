import { GRID, isInBounds, type GridCoord } from './constants'
import type { GridEntity, OccupancyGrid } from './occupancy'

export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface CatInput {
  /** 世界 XZ 平面上的移動方向（已依鏡頭方向投影，長度 0~1） */
  moveX: number
  moveZ: number
  /** 本幀是否觸發跳躍（按下瞬間） */
  jumpJustPressed: boolean
  /** 是否持續按住放屁 */
  fartHeld: boolean
}

export interface CatState {
  readonly position: Readonly<Vec3>
  readonly velocity: Readonly<Vec3>
  readonly facingYaw: number
  readonly grounded: boolean
  readonly isFarting: boolean
  readonly logicalCell: Readonly<GridCoord>
}

const CAT_HALF_WIDTH = 0.38
const CAT_HEIGHT = 0.9
const MOVE_SPEED = 5.2
const GRAVITY = 24
/** 最大跳躍高度 ≈ v² / (2g) ≈ 2.30 格：可穩跳 2 格（地板→床/椅→書桌），無法從地板直跳 3 格 */
const JUMP_VELOCITY = 10.5
const COYOTE_TIME = 0.08
const JUMP_BUFFER_TIME = 0.1
const EPS = 0.001

/**
 * 貓咪連續移動＋AABB 格子碰撞控制器（引擎無關）。
 * - position 為貓咪底面中心點
 * - 碰撞對齊 1×1×1 格子邊界
 * - 同步更新 OccupancyGrid 的邏輯佔用格
 */
export class CatController {
  private readonly pos: Vec3
  private readonly vel: Vec3 = { x: 0, y: 0, z: 0 }
  private facingYaw = 0
  private grounded = true
  private isFarting = false
  private coyoteTimer = 0
  private jumpBufferTimer = 0

  constructor(
    private readonly grid: OccupancyGrid,
    private readonly entity: GridEntity,
  ) {
    this.pos = {
      x: entity.origin.x + 0.5,
      y: entity.origin.y,
      z: entity.origin.z + 0.5,
    }
  }

  getState(): CatState {
    return {
      position: { ...this.pos },
      velocity: { ...this.vel },
      facingYaw: this.facingYaw,
      grounded: this.grounded,
      isFarting: this.isFarting,
      logicalCell: { ...this.entity.origin },
    }
  }

  step(input: CatInput, rawDt: number): CatState {
    const dt = Math.min(Math.max(rawDt, 0), 0.05)

    // 水平輸入正規化
    let mx = input.moveX
    let mz = input.moveZ
    const len = Math.hypot(mx, mz)
    if (len > 1) {
      mx /= len
      mz /= len
    }

    this.vel.x = mx * MOVE_SPEED
    this.vel.z = mz * MOVE_SPEED
    if (len > 0.05) {
      this.facingYaw = Math.atan2(mx, mz)
    }

    // 土狼時間與跳躍緩衝（讓跳上家具的手感更順）
    if (this.grounded) {
      this.coyoteTimer = COYOTE_TIME
    } else {
      this.coyoteTimer = Math.max(0, this.coyoteTimer - dt)
    }

    if (input.jumpJustPressed) {
      this.jumpBufferTimer = JUMP_BUFFER_TIME
    } else {
      this.jumpBufferTimer = Math.max(0, this.jumpBufferTimer - dt)
    }

    if (this.jumpBufferTimer > 0 && this.coyoteTimer > 0) {
      this.vel.y = JUMP_VELOCITY
      this.grounded = false
      this.coyoteTimer = 0
      this.jumpBufferTimer = 0
    }

    // 重力
    this.vel.y -= GRAVITY * dt

    // 分軸移動與 AABB 格子碰撞（X → Z → Y）
    this.moveX(this.vel.x * dt)
    this.moveZ(this.vel.z * dt)
    this.moveY(this.vel.y * dt)

    this.isFarting = input.fartHeld
    this.syncLogicalCell()

    return this.getState()
  }

  private isSolid(cx: number, cy: number, cz: number): boolean {
    if (!isInBounds(cx, cy, cz)) return true
    const id = this.grid.getCell(cx, cy, cz)
    return id !== 0 && id !== this.entity.id
  }

  private moveX(dx: number): void {
    if (dx === 0) return
    const nextX = this.pos.x + dx
    const minY = Math.floor(this.pos.y + EPS)
    const maxY = Math.floor(this.pos.y + CAT_HEIGHT - EPS)
    const minZ = Math.floor(this.pos.z - CAT_HALF_WIDTH + EPS)
    const maxZ = Math.floor(this.pos.z + CAT_HALF_WIDTH - EPS)

    if (dx > 0) {
      const targetCellX = Math.floor(nextX + CAT_HALF_WIDTH)
      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) {
          if (this.isSolid(targetCellX, y, z)) {
            this.pos.x = targetCellX - CAT_HALF_WIDTH
            this.vel.x = 0
            return
          }
        }
      }
    } else {
      const targetCellX = Math.floor(nextX - CAT_HALF_WIDTH)
      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) {
          if (this.isSolid(targetCellX, y, z)) {
            this.pos.x = targetCellX + 1 + CAT_HALF_WIDTH
            this.vel.x = 0
            return
          }
        }
      }
    }
    this.pos.x = nextX
  }

  private moveZ(dz: number): void {
    if (dz === 0) return
    const nextZ = this.pos.z + dz
    const minY = Math.floor(this.pos.y + EPS)
    const maxY = Math.floor(this.pos.y + CAT_HEIGHT - EPS)
    const minX = Math.floor(this.pos.x - CAT_HALF_WIDTH + EPS)
    const maxX = Math.floor(this.pos.x + CAT_HALF_WIDTH - EPS)

    if (dz > 0) {
      const targetCellZ = Math.floor(nextZ + CAT_HALF_WIDTH)
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          if (this.isSolid(x, y, targetCellZ)) {
            this.pos.z = targetCellZ - CAT_HALF_WIDTH
            this.vel.z = 0
            return
          }
        }
      }
    } else {
      const targetCellZ = Math.floor(nextZ - CAT_HALF_WIDTH)
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          if (this.isSolid(x, y, targetCellZ)) {
            this.pos.z = targetCellZ + 1 + CAT_HALF_WIDTH
            this.vel.z = 0
            return
          }
        }
      }
    }
    this.pos.z = nextZ
  }

  private moveY(dy: number): void {
    const nextY = this.pos.y + dy
    const minX = Math.floor(this.pos.x - CAT_HALF_WIDTH + EPS)
    const maxX = Math.floor(this.pos.x + CAT_HALF_WIDTH - EPS)
    const minZ = Math.floor(this.pos.z - CAT_HALF_WIDTH + EPS)
    const maxZ = Math.floor(this.pos.z + CAT_HALF_WIDTH - EPS)

    if (dy <= 0) {
      const targetCellY = Math.floor(nextY)
      for (let x = minX; x <= maxX; x++) {
        for (let z = minZ; z <= maxZ; z++) {
          if (this.isSolid(x, targetCellY, z)) {
            this.pos.y = targetCellY + 1
            this.vel.y = 0
            this.grounded = true
            return
          }
        }
      }
      this.grounded = false
    } else {
      const targetCellY = Math.floor(nextY + CAT_HEIGHT)
      for (let x = minX; x <= maxX; x++) {
        for (let z = minZ; z <= maxZ; z++) {
          if (this.isSolid(x, targetCellY, z)) {
            this.pos.y = targetCellY - CAT_HEIGHT
            this.vel.y = 0
            return
          }
        }
      }
    }
    this.pos.y = nextY
  }

  private syncLogicalCell(): void {
    const cx = Math.min(GRID.NX - 1, Math.max(0, Math.floor(this.pos.x)))
    const cy = Math.min(GRID.NY - 1, Math.max(0, Math.floor(this.pos.y + 0.05)))
    const cz = Math.min(GRID.NZ - 1, Math.max(0, Math.floor(this.pos.z)))

    const cur = this.entity.origin
    if (cx !== cur.x || cy !== cur.y || cz !== cur.z) {
      this.grid.move(this.entity.id, { x: cx, y: cy, z: cz })
    }
  }
}
