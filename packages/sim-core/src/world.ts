import { CatController, type CatState } from './catController'
import { DeviceSystem, type DeviceId, type DeviceState } from './devices'
import { GameLoop, type GameLoopSnapshot } from './gameLoop'
import { HumanController, type HumanState } from './humanController'
import { LEVEL_01, loadLevel, type LevelData, type LoadedLevel } from './level'
import {
  defaultFootprint,
  type EntityKind,
  type FurnitureKind,
  type GridEntity,
  type OccupancyGrid,
} from './occupancy'
import { createRng, type RngFn } from './rng'
import { StinkSystem, type StinkSnapshot } from './stinkSystem'

export type EditorToolKind = EntityKind | 'erase'

export interface WorldStepInput {
  /** 世界 XZ 平面上的移動方向（已依鏡頭方向投影，長度 0~1） */
  readonly moveX: number
  readonly moveZ: number
  readonly jumpJustPressed: boolean
  readonly fartHeld: boolean
}

export interface WorldFrame {
  readonly cat: CatState
  readonly human: HumanState
  readonly devices: DeviceState
  readonly stink: StinkSnapshot
  readonly game: GameLoopSnapshot
  readonly timeSec: number
}

export interface SimulationWorldOptions {
  readonly seed?: number
}

/**
 * 模擬世界總管（引擎無關）：
 * 收攏 OccupancyGrid、CatController、HumanController、DeviceSystem、StinkSystem、GameLoop 的編排，
 * 以及關卡編輯器規則。Three.js 與未來的 Babylon.js 只需呼叫 step() 並渲染回傳的 WorldFrame。
 */
export class SimulationWorld {
  private levelData: LevelData
  private loaded!: LoadedLevel
  private catController!: CatController
  private humanController!: HumanController
  private gameLoop!: GameLoop
  private stinkSystem!: StinkSystem
  private readonly deviceSystem = new DeviceSystem()

  private rng: RngFn
  private readonly defaultSeed: number | undefined
  private simTimeSec = 0
  private lastCatState!: CatState
  private lastHumanState!: HumanState

  constructor(initialLevel: LevelData = LEVEL_01, options: SimulationWorldOptions = {}) {
    this.defaultSeed = options.seed
    this.levelData = initialLevel
    this.rng = createRng(options.seed)
    this.reset(initialLevel, options.seed)
  }

  get grid(): OccupancyGrid {
    return this.loaded.grid
  }

  get stink(): StinkSystem {
    return this.stinkSystem
  }

  get catEntity(): GridEntity {
    return this.loaded.cat
  }

  get humanEntity(): GridEntity {
    return this.loaded.human
  }

  getLevelData(): LevelData {
    return this.levelData
  }

  isEnded(): boolean {
    return this.gameLoop.isEnded()
  }

  /** 重新載入關卡並重置所有模擬系統（可選擇指定新 seed 以重現結果） */
  reset(levelData: LevelData = this.levelData, seed: number | undefined = this.defaultSeed): WorldFrame {
    this.levelData = levelData
    this.rng = createRng(seed)
    this.simTimeSec = 0

    this.loaded = loadLevel(levelData)
    this.catController = new CatController(this.loaded.grid, this.loaded.cat)
    this.humanController = new HumanController(
      this.loaded.grid,
      this.loaded.human,
      this.loaded.cat,
      this.rng,
    )
    this.gameLoop = new GameLoop()
    this.stinkSystem = new StinkSystem(this.rng)
    this.deviceSystem.reset()

    this.lastCatState = this.catController.getState()
    this.lastHumanState = this.humanController.getState()
    return this.getFrame()
  }

  getFrame(): WorldFrame {
    return {
      cat: this.lastCatState,
      human: this.lastHumanState,
      devices: this.deviceSystem.getState(),
      stink: this.stinkSystem.getSnapshot(),
      game: this.gameLoop.getSnapshot(),
      timeSec: this.simTimeSec,
    }
  }

  toggleDevice(id: DeviceId): DeviceState {
    return this.deviceSystem.toggle(id)
  }

  /** 推進一幀完整模擬（5 個系統的協調與資料傳遞全部封裝於此） */
  step(input: WorldStepInput, rawDt: number): WorldFrame {
    const dt = Math.min(Math.max(rawDt, 0), 0.05)
    if (this.gameLoop.isEnded()) {
      return this.getFrame()
    }

    this.simTimeSec += dt

    const diff = this.gameLoop.getDifficulty()
    const forcedBurst = this.gameLoop.isForcedBurst()

    // 1. 人類 AI 步進與摸貓互動協調（隨無盡等級加速）
    const humanState = this.humanController.step(
      this.lastCatState.position,
      this.lastCatState.grounded,
      dt,
      {
        speedMultiplier: diff.humanSpeedMultiplier,
        activityDuration: diff.humanActivityDuration,
      },
    )
    const isBeingPetted = humanState.petCatHoldPos !== null

    if (humanState.petCatHoldPos) {
      const petBounce = Math.abs(Math.sin(this.simTimeSec * 18)) * 0.05
      this.catController.teleportTo(
        humanState.petCatHoldPos.x,
        humanState.petCatHoldPos.y + petBounce,
        humanState.petCatHoldPos.z,
        false,
      )
    } else if (humanState.releaseCatCell) {
      this.catController.teleportTo(
        humanState.releaseCatCell.x + 0.5,
        humanState.releaseCatCell.y,
        humanState.releaseCatCell.z + 0.5,
        true,
      )
    }

    // 2. 貓咪移動、跳躍與格子碰撞（強制大爆屁時就算沒按空白鍵也會噴屁）
    const catState = this.catController.step(
      {
        moveX: input.moveX,
        moveZ: input.moveZ,
        jumpJustPressed: input.jumpJustPressed,
        fartHeld: input.fartHeld || forcedBurst,
        locked: isBeingPetted,
      },
      dt,
    )

    // 3. 房間設備（風扇擺頭等）
    const deviceState = this.deviceSystem.step(dt)

    // 4. 臭氣粒子模擬（隨等級越來越濃，強制大爆屁會爆出超濃毒雲）
    const prevExhausted = this.stinkSystem.getSnapshot().totalExhausted
    const backX = -Math.sin(catState.facingYaw)
    const backZ = -Math.cos(catState.facingYaw)
    const stinkSnapshot = this.stinkSystem.step(
      this.loaded.grid,
      {
        active: catState.isFarting,
        x: catState.position.x + backX * 0.44,
        y: catState.position.y + 0.36,
        z: catState.position.z + backZ * 0.44,
        dirX: backX,
        dirZ: backZ,
      },
      humanState.headCell,
      dt,
      this.deviceSystem,
      {
        potencyMultiplier: diff.potencyMultiplier,
        forcedBurst,
      },
    )
    const exhaustedDelta = stinkSnapshot.totalExhausted - prevExhausted

    // 5. 無盡模式循環（肚子脹氣、強制大爆屁、動態難度與連擊計分）
    const voluntaryFarting = input.fartHeld && !isBeingPetted && !forcedBurst
    const gameSnapshot = this.gameLoop.step(
      voluntaryFarting,
      stinkSnapshot.suspicion,
      exhaustedDelta,
      dt,
    )

    this.lastCatState = catState
    this.lastHumanState = humanState

    return {
      cat: catState,
      human: humanState,
      devices: deviceState,
      stink: stinkSnapshot,
      game: gameSnapshot,
      timeSec: this.simTimeSec,
    }
  }

  // --- 關卡編輯器 API（Three.js / Babylon.js 共用同一套驗證與資料同步） ---

  canApplyEditorTool(tool: EditorToolKind, cx: number, cz: number): boolean {
    if (tool === 'erase') {
      const target = this.loaded.grid.getEntityAt(cx, 0, cz)
      return Boolean(target && target.kind !== 'cat' && target.kind !== 'human')
    }
    const ignoreId =
      tool === 'cat'
        ? this.loaded.cat.id
        : tool === 'human'
          ? this.loaded.human.id
          : 0
    return this.loaded.grid.canPlace({ x: cx, y: 0, z: cz }, defaultFootprint(tool), ignoreId)
  }

  applyEditorTool(tool: EditorToolKind, cx: number, cz: number): boolean {
    if (tool === 'erase') return this.eraseFurnitureAt(cx, cz)
    if (!this.canApplyEditorTool(tool, cx, cz)) return false

    if (tool === 'cat') {
      if (!this.loaded.grid.move(this.loaded.cat.id, { x: cx, y: 0, z: cz })) return false
    } else if (tool === 'human') {
      if (!this.loaded.grid.move(this.loaded.human.id, { x: cx, y: 0, z: cz })) return false
    } else {
      if (!this.loaded.grid.place(tool, { x: cx, y: 0, z: cz })) return false
    }
    this.syncLevelDataFromGrid()
    return true
  }

  eraseFurnitureAt(cx: number, cz: number): boolean {
    const target = this.loaded.grid.getEntityAt(cx, 0, cz)
    if (!target || target.kind === 'cat' || target.kind === 'human') return false
    const removed = this.loaded.grid.remove(target.id)
    if (removed) this.syncLevelDataFromGrid()
    return removed
  }

  updateLevelMeta(meta: {
    name: string
    fartQuota: number
    parTime: number
    parPresses: number
  }): LevelData {
    this.levelData = {
      ...this.levelData,
      name: meta.name,
      fartQuota: meta.fartQuota,
      parTime: meta.parTime,
      parPresses: meta.parPresses,
    }
    return this.levelData
  }

  private syncLevelDataFromGrid(): void {
    const furniture: Array<{ type: FurnitureKind; x: number; z: number }> = []
    for (const ent of this.loaded.grid.getAllEntities()) {
      if (ent.kind === 'bed' || ent.kind === 'desk' || ent.kind === 'chair') {
        furniture.push({ type: ent.kind, x: ent.origin.x, z: ent.origin.z })
      }
    }
    this.levelData = {
      ...this.levelData,
      furniture,
      cat: { x: this.loaded.cat.origin.x, z: this.loaded.cat.origin.z },
      human: { x: this.loaded.human.origin.x, z: this.loaded.human.origin.z },
    }
  }
}
