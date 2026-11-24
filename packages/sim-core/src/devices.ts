import { GRID } from './constants'

export type DeviceId = 'fan' | 'fanOscillate' | 'ac' | 'pc' | 'window' | 'door'

export interface DeviceState {
  readonly fanOn: boolean
  readonly fanOscillate: boolean
  /** 電風扇目前朝向角（弧度，0 為 +Z，Math.PI/2 為 +X） */
  readonly fanYaw: number
  readonly acOn: boolean
  /** 電腦主機高負載發熱（產生向上熱浮力） */
  readonly pcHot: boolean
  readonly windowOpen: boolean
  readonly doorOpen: boolean
}

export interface AirflowForce {
  ax: number
  ay: number
  az: number
}

/** 房間內 5 項固定設備的空間配置（16 × 10 × 16 座標系） */
export const DEVICE_LAYOUT = {
  fan: { x: 3.5, y: 1.1, z: 12.5, baseYaw: Math.PI * 0.78 }, // 朝向房間中央／北側
  ac: { x: 8.0, y: 7.6, z: 0.35 }, // 北牆高處，往 +Z 與 -Y 吹冷風
  pc: { x: 14.5, y: 0.9, z: 1.5 }, // 書桌右側主機，發熱時產生 +Y 熱對流
  window: { x: 0, yMin: 2.0, yMax: 5.5, zMin: 6.0, zMax: 10.0 }, // 西牆排氣窗
  door: { z: GRID.NZ, xMin: 7.0, xMax: 9.0, yMin: 0, yMax: 3.5 }, // 南牆排氣門
} as const

/**
 * 房間 IoT 設備控制器（引擎無關）：
 * 管理電風扇（含擺頭）、冷氣、電腦主機熱浮力、窗戶與門開關，
 * 並計算任意 3D 座標處的氣流／熱對流加速度與排氣口判定。
 */
export class DeviceSystem {
  private fanOn = false
  private fanOscillate = true
  private fanPhase = 0
  private fanYaw: number = DEVICE_LAYOUT.fan.baseYaw
  private acOn = false
  private pcHot = false
  private windowOpen = false
  private doorOpen = false

  reset(): void {
    this.fanOn = false
    this.fanOscillate = true
    this.fanPhase = 0
    this.fanYaw = DEVICE_LAYOUT.fan.baseYaw
    this.acOn = false
    this.pcHot = false
    this.windowOpen = false
    this.doorOpen = false
  }

  toggle(id: DeviceId): DeviceState {
    switch (id) {
      case 'fan':
        this.fanOn = !this.fanOn
        break
      case 'fanOscillate':
        this.fanOscillate = !this.fanOscillate
        break
      case 'ac':
        this.acOn = !this.acOn
        break
      case 'pc':
        this.pcHot = !this.pcHot
        break
      case 'window':
        this.windowOpen = !this.windowOpen
        break
      case 'door':
        this.doorOpen = !this.doorOpen
        break
    }
    return this.getState()
  }

  step(rawDt: number): DeviceState {
    const dt = Math.min(Math.max(rawDt, 0), 0.05)
    if (this.fanOn && this.fanOscillate) {
      this.fanPhase += dt * 1.15
      this.fanYaw = DEVICE_LAYOUT.fan.baseYaw + Math.sin(this.fanPhase) * 0.65
    }
    return this.getState()
  }

  getState(): DeviceState {
    return {
      fanOn: this.fanOn,
      fanOscillate: this.fanOscillate,
      fanYaw: this.fanYaw,
      acOn: this.acOn,
      pcHot: this.pcHot,
      windowOpen: this.windowOpen,
      doorOpen: this.doorOpen,
    }
  }

  /**
   * 計算座標 (px, py, pz) 處受到的所有設備氣流與熱浮力加速度（寫入 out 避免 GC）。
   */
  sampleAirflow(px: number, py: number, pz: number, out: AirflowForce): void {
    let ax = 0
    let ay = 0
    let az = 0

    // 1. 電風扇水平推風（錐形吹拂區）
    if (this.fanOn) {
      const fx = px - DEVICE_LAYOUT.fan.x
      const fy = py - DEVICE_LAYOUT.fan.y
      const fz = pz - DEVICE_LAYOUT.fan.z
      const dirX = Math.sin(this.fanYaw)
      const dirZ = Math.cos(this.fanYaw)
      const forwardDist = fx * dirX + fz * dirZ
      if (forwardDist > 0.1 && forwardDist < 9.5 && Math.abs(fy) < 2.2) {
        const lateralDist = Math.abs(fx * dirZ - fz * dirX)
        const coneRadius = 1.0 + forwardDist * 0.28
        if (lateralDist < coneRadius) {
          const strength = (1 - forwardDist / 9.5) * (1 - lateralDist / coneRadius) * 8.5
          ax += dirX * strength
          az += dirZ * strength
          ay += 0.25 * strength * 0.15
        }
      }
    }

    // 2. 冷氣出風口（往 +Z 吹送＋向下沉降冷風 -Y）
    if (this.acOn) {
      const dx = Math.abs(px - DEVICE_LAYOUT.ac.x)
      const dz = pz - DEVICE_LAYOUT.ac.z
      if (dx < 3.6 && dz > 0 && dz < 8.0 && py > 0.5 && py < 8.5) {
        const falloff = (1 - dx / 3.6) * (1 - dz / 8.0)
        az += falloff * 5.2
        ay -= falloff * 3.4 // 冷空氣下沉
      }
    }

    // 3. 電腦主機高負載發熱（熱對流向上浮力 +Y）
    if (this.pcHot) {
      const hDist = Math.hypot(px - DEVICE_LAYOUT.pc.x, pz - DEVICE_LAYOUT.pc.z)
      if (hDist < 2.6 && py >= 0.2 && py < GRID.NY - 0.3) {
        const strength = (1 - hDist / 2.6) * 6.8
        ay += strength
      }
    }

    // 4. 窗戶開啟：窗邊微弱往外抽風（-X）
    if (this.windowOpen) {
      const w = DEVICE_LAYOUT.window
      if (px < 2.6 && py >= w.yMin - 0.8 && py <= w.yMax + 0.8 && pz >= w.zMin - 0.8 && pz <= w.zMax + 0.8) {
        const pull = (1 - px / 2.6) * 4.5
        ax -= pull
      }
    }

    // 5. 門開啟：門邊微弱往外抽風（+Z）
    if (this.doorOpen) {
      const d = DEVICE_LAYOUT.door
      const distToDoor = d.z - pz
      if (distToDoor < 2.6 && px >= d.xMin - 0.8 && px <= d.xMax + 0.8 && py >= d.yMin && py <= d.yMax + 0.8) {
        const pull = (1 - distToDoor / 2.6) * 4.5
        az += pull
      }
    }

    out.ax = ax
    out.ay = ay
    out.az = az
  }

  /** 判斷粒子是否已從開啟的門或窗戶排出房間 */
  isExhausted(px: number, py: number, pz: number): boolean {
    if (this.windowOpen) {
      const w = DEVICE_LAYOUT.window
      if (px <= 0.18 && py >= w.yMin && py <= w.yMax && pz >= w.zMin && pz <= w.zMax) {
        return true
      }
    }
    if (this.doorOpen) {
      const d = DEVICE_LAYOUT.door
      if (pz >= d.z - 0.18 && px >= d.xMin && px <= d.xMax && py >= d.yMin && py <= d.yMax) {
        return true
      }
    }
    return false
  }
}
