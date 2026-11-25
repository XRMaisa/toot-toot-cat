import {
  CELL_COUNT,
  GRID,
  SUSPICION_THRESHOLD,
  cellIndex,
  isInBounds,
  type GridCoord,
} from './constants'
import type { AirflowForce, DeviceSystem } from './devices'
import type { OccupancyGrid } from './occupancy'
import type { RngFn } from './rng'

export type HumanAlertLevel = 'calm' | 'suspicious' | 'caught'

export interface StinkEmitParams {
  /** 是否正在放屁 */
  readonly active: boolean
  /** 噴出位置（貓咪屁股世界座標） */
  readonly x: number
  readonly y: number
  readonly z: number
  /** 噴出方向（單位向量，通常為貓咪背後） */
  readonly dirX: number
  readonly dirZ: number
}

export interface StinkSnapshot {
  readonly activeParticles: number
  readonly suspicion: number
  readonly alertLevel: HumanAlertLevel
  readonly totalInhaled: number
  readonly totalExhausted: number
  readonly maxCellCount: number
}

export const MAX_STINK_PARTICLES = 3000

const EMIT_RATE = 110 // 持續按住時每秒產生粒子數
const INITIAL_BURST_COUNT = 80 // 一開始放屁瞬間爆出高濃度的 2×2 濃雲
const INITIAL_SPREAD_RADIUS = 1.0 // 2×2 格子半徑（直徑 = 2 格）
const PARTICLE_MIN_LIFE = 20.0
const PARTICLE_MAX_LIFE = 30.0
const DIFFUSION_STRENGTH = 10.0 // 隨機擴散加速度
const DRAG = 0.65 // 空氣阻力（降低阻力讓臭氣飄更遠）
const BASE_BUOYANCY = 1.6 // 自然上升浮力
const BOUNCE_DAMPING = 0.45

const SUSPICION_PER_PARTICLE = 3.2
const SUSPICION_DECAY_PER_SEC = 5.5

/**
 * 粒子＋格子混合式臭氣模擬（純 TypeScript，TypedArray 零 GC）。
 * 1. 粒子負責擴散、碰家具/牆壁反彈與壽命衰減
 * 2. 每步統計各格子粒子數（cellCounts），直接供給工程師模式 3D 熱力圖
 * 3. 人類頭部所在格子會吸入粒子（粒子消失）並累積懷疑值
 */
export class StinkSystem {
  readonly capacity = MAX_STINK_PARTICLES

  // Struct-of-Arrays（給渲染引擎直接讀取，無需分配物件）
  readonly posX = new Float32Array(MAX_STINK_PARTICLES)
  readonly posY = new Float32Array(MAX_STINK_PARTICLES)
  readonly posZ = new Float32Array(MAX_STINK_PARTICLES)
  readonly velX = new Float32Array(MAX_STINK_PARTICLES)
  readonly velY = new Float32Array(MAX_STINK_PARTICLES)
  readonly velZ = new Float32Array(MAX_STINK_PARTICLES)
  readonly age = new Float32Array(MAX_STINK_PARTICLES)
  readonly maxAge = new Float32Array(MAX_STINK_PARTICLES)
  readonly alive = new Uint8Array(MAX_STINK_PARTICLES)

  /** 每格目前包含的粒子數量（長度 = 16×10×16 = 2560） */
  readonly cellCounts = new Uint16Array(CELL_COUNT)

  private activeCount = 0
  private emitCarry = 0
  private wasEmitting = false
  private suspicion = 0
  private totalInhaled = 0
  private totalExhausted = 0
  private maxCellCount = 0
  private nextSearchSlot = 0
  private readonly airflowScratch: AirflowForce = { ax: 0, ay: 0, az: 0 }
  private readonly rng: RngFn

  constructor(rng: RngFn = Math.random) {
    this.rng = rng
  }

  reset(): void {
    this.alive.fill(0)
    this.cellCounts.fill(0)
    this.activeCount = 0
    this.emitCarry = 0
    this.wasEmitting = false
    this.suspicion = 0
    this.totalInhaled = 0
    this.totalExhausted = 0
    this.maxCellCount = 0
    this.nextSearchSlot = 0
  }

  getSnapshot(): StinkSnapshot {
    return {
      activeParticles: this.activeCount,
      suspicion: this.suspicion,
      alertLevel: this.getAlertLevel(),
      totalInhaled: this.totalInhaled,
      totalExhausted: this.totalExhausted,
      maxCellCount: this.maxCellCount,
    }
  }

  getAlertLevel(): HumanAlertLevel {
    if (this.suspicion >= SUSPICION_THRESHOLD.caught) return 'caught'
    if (this.suspicion >= SUSPICION_THRESHOLD.suspicious) return 'suspicious'
    return 'calm'
  }

  step(
    grid: OccupancyGrid,
    emit: StinkEmitParams,
    humanHeadCell: Readonly<GridCoord>,
    rawDt: number,
    devices?: DeviceSystem,
  ): StinkSnapshot {
    const dt = Math.min(Math.max(rawDt, 0), 0.05)

    // 1. 產生新粒子（一開始放屁立刻爆出至少 2×2 範圍的濃雲，按住時持續維持 2×2 寬幅擴散）
    if (emit.active) {
      if (!this.wasEmitting) {
        for (let i = 0; i < INITIAL_BURST_COUNT; i++) {
          this.spawnParticle(grid, emit, true)
        }
      }
      this.emitCarry += EMIT_RATE * dt
      const toSpawn = Math.floor(this.emitCarry)
      this.emitCarry -= toSpawn
      for (let i = 0; i < toSpawn; i++) {
        this.spawnParticle(grid, emit, false)
      }
      this.wasEmitting = true
    } else {
      this.emitCarry = 0
      this.wasEmitting = false
    }

    // 2. 更新粒子位置、氣流／熱浮力、反彈、門窗排氣、人類頭部吸入，並統計進格子
    this.cellCounts.fill(0)
    let aliveNow = 0
    let inhaledNow = 0
    let exhaustedNow = 0
    let peakCell = 0

    const dragFactor = Math.max(0, 1 - DRAG * dt)
    const headX = humanHeadCell.x
    const headY = humanHeadCell.y
    const headZ = humanHeadCell.z

    for (let i = 0; i < this.capacity; i++) {
      if (this.alive[i] === 0) continue

      const nextAge = (this.age[i] ?? 0) + dt
      if (nextAge >= (this.maxAge[i] ?? 1)) {
        this.alive[i] = 0
        continue
      }
      this.age[i] = nextAge

      let px = this.posX[i] ?? 0
      let py = this.posY[i] ?? 0
      let pz = this.posZ[i] ?? 0

      // 採樣房間設備氣流與熱浮力
      let flowX = 0
      let flowY = 0
      let flowZ = 0
      if (devices) {
        devices.sampleAirflow(px, py, pz, this.airflowScratch)
        flowX = this.airflowScratch.ax
        flowY = this.airflowScratch.ay
        flowZ = this.airflowScratch.az
      }

      // 隨機擴散＋設備氣流／熱浮力＋自然微浮力＋阻力
      let vx =
        ((this.velX[i] ?? 0) + (flowX + (this.rng() - 0.5) * 2 * DIFFUSION_STRENGTH) * dt) *
        dragFactor
      let vy =
        ((this.velY[i] ?? 0) +
          (flowY + BASE_BUOYANCY + (this.rng() - 0.5) * 1.4 * DIFFUSION_STRENGTH) * dt) *
        dragFactor
      let vz =
        ((this.velZ[i] ?? 0) + (flowZ + (this.rng() - 0.5) * 2 * DIFFUSION_STRENGTH) * dt) *
        dragFactor

      // 分軸移動＋碰撞家具或牆壁反彈
      const nx = px + vx * dt
      if (this.hitsObstacle(grid, nx, py, pz)) {
        // 先檢查是否從開啟的西牆窗戶排出
        if (devices && devices.isExhausted(nx, py, pz)) {
          this.alive[i] = 0
          exhaustedNow++
          continue
        }
        vx = -vx * BOUNCE_DAMPING
      } else {
        px = nx
      }

      const ny = py + vy * dt
      if (this.hitsObstacle(grid, px, ny, pz)) {
        vy = -vy * BOUNCE_DAMPING
      } else {
        py = ny
      }

      const nz = pz + vz * dt
      if (this.hitsObstacle(grid, px, py, nz)) {
        // 檢查是否從開啟的南牆門排出
        if (devices && devices.isExhausted(px, py, nz)) {
          this.alive[i] = 0
          exhaustedNow++
          continue
        }
        vz = -vz * BOUNCE_DAMPING
      } else {
        pz = nz
      }

      // 確保粒子在合法範圍內
      px = Math.min(GRID.NX - 0.02, Math.max(0.02, px))
      py = Math.min(GRID.NY - 0.02, Math.max(0.02, py))
      pz = Math.min(GRID.NZ - 0.02, Math.max(0.02, pz))

      if (devices && devices.isExhausted(px, py, pz)) {
        this.alive[i] = 0
        exhaustedNow++
        continue
      }

      const cx = Math.floor(px)
      const cy = Math.floor(py)
      const cz = Math.floor(pz)

      // 人類頭部格子吸入粒子
      if (cx === headX && cy === headY && cz === headZ) {
        this.alive[i] = 0
        inhaledNow++
        continue
      }

      this.posX[i] = px
      this.posY[i] = py
      this.posZ[i] = pz
      this.velX[i] = vx
      this.velY[i] = vy
      this.velZ[i] = vz

      aliveNow++
      if (isInBounds(cx, cy, cz)) {
        const idx = cellIndex(cx, cy, cz)
        const count = (this.cellCounts[idx] ?? 0) + 1
        this.cellCounts[idx] = count
        if (count > peakCell) peakCell = count
      }
    }

    this.activeCount = aliveNow
    this.totalExhausted += exhaustedNow
    this.maxCellCount = peakCell

    // 3. 更新懷疑值（0 ~ 100）
    if (inhaledNow > 0) {
      this.totalInhaled += inhaledNow
      this.suspicion = Math.min(100, this.suspicion + inhaledNow * SUSPICION_PER_PARTICLE)
    } else if (this.suspicion > 0) {
      this.suspicion = Math.max(0, this.suspicion - SUSPICION_DECAY_PER_SEC * dt)
    }

    return this.getSnapshot()
  }

  private hitsObstacle(grid: OccupancyGrid, wx: number, wy: number, wz: number): boolean {
    const cx = Math.floor(wx)
    const cy = Math.floor(wy)
    const cz = Math.floor(wz)
    return grid.isSolidForSmell(cx, cy, cz)
  }

  private spawnParticle(grid: OccupancyGrid, emit: StinkEmitParams, isBurst: boolean): void {
    const slot = this.findFreeSlot()
    if (slot < 0) return

    // 在至少 2×2 格子（直徑 2 單位）的水平圓盤內均勻分布
    const angle = this.rng() * Math.PI * 2
    const maxR = isBurst ? INITIAL_SPREAD_RADIUS : INITIAL_SPREAD_RADIUS * 0.85
    const r = Math.sqrt(this.rng()) * maxR
    const offX = Math.cos(angle) * r
    const offZ = Math.sin(angle) * r
    const offY = this.rng() * (isBurst ? 0.95 : 0.65)

    let sx = emit.x + offX
    let sy = emit.y + offY
    let sz = emit.z + offZ

    // 如果隨機點落進牆壁或家具，退回貓咪屁股中心點避免生在障礙物裡
    if (this.hitsObstacle(grid, sx, sy, sz)) {
      sx = emit.x - emit.dirX * 0.25
      sy = emit.y + 0.15
      sz = emit.z - emit.dirZ * 0.25
    }
    sx = Math.min(GRID.NX - 0.05, Math.max(0.05, sx))
    sy = Math.min(GRID.NY - 0.05, Math.max(0.05, sy))
    sz = Math.min(GRID.NZ - 0.05, Math.max(0.05, sz))

    const baseSpeed = isBurst ? 3.0 + this.rng() * 2.0 : 2.4 + this.rng() * 1.6
    const radialBoost = isBurst ? 2.2 : 1.5
    this.posX[slot] = sx
    this.posY[slot] = sy
    this.posZ[slot] = sz
    this.velX[slot] = emit.dirX * baseSpeed + Math.cos(angle) * radialBoost
    this.velY[slot] = 0.8 + this.rng() * 1.4
    this.velZ[slot] = emit.dirZ * baseSpeed + Math.sin(angle) * radialBoost
    this.age[slot] = 0
    this.maxAge[slot] =
      PARTICLE_MIN_LIFE + this.rng() * (PARTICLE_MAX_LIFE - PARTICLE_MIN_LIFE)
    this.alive[slot] = 1
  }

  private findFreeSlot(): number {
    for (let offset = 0; offset < this.capacity; offset++) {
      const idx = (this.nextSearchSlot + offset) % this.capacity
      if (this.alive[idx] === 0) {
        this.nextSearchSlot = (idx + 1) % this.capacity
        return idx
      }
    }
    return -1
  }
}
