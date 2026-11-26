import { SUSPICION_THRESHOLD } from './constants'

export type GamePhase = 'playing' | 'lost'

export interface GameLoopSnapshot {
  readonly phase: GamePhase
  readonly elapsedSec: number
  /** 動態難度等級（Lv.1 起跳，每 20 秒升級） */
  readonly level: number
  /** 屁的濃度倍率（隨等級提升，1.0x → 1.25x → 1.5x...） */
  readonly potencyMultiplier: number
  /** 人類移動速度倍率 */
  readonly humanSpeedMultiplier: number
  /** 人類切換行動間隔秒數 */
  readonly humanActivityDuration: number
  /** 貓咪肚子脹氣值（0 ~ 100，滿 100 強制大爆屁） */
  readonly bellyPressure: number
  /** 是否正處於「忍不住強制大爆屁」狀態 */
  readonly isForcedBurst: boolean
  /** 強制大爆屁剩餘秒數 */
  readonly forcedBurstRemaining: number
  /** 主動連續放屁的加分倍率（1.0 ~ 3.0） */
  readonly comboMultiplier: number
  readonly fartPresses: number
  readonly totalExhausted: number
  readonly maxSuspicion: number
  readonly score: number
}

const LEVEL_INTERVAL_SEC = 20 // 每 20 秒升 1 級
const BASE_PRESSURE_RISE = 7.5 // Lv.1 每秒自然脹氣量
const PRESSURE_RISE_PER_LEVEL = 1.8 // 每升 1 級增加的自然脹氣速度
const VOLUNTARY_DRAIN_PER_SEC = 30 // 主動放屁每秒洩壓量
const FORCED_BURST_DURATION = 1.2 // 脹到 100% 時強制大爆屁秒數
const FORCED_BURST_DRAIN_PER_SEC = 62 // 強制大爆屁期間洩壓速度

const SCORE_PER_FART_SEC = 45
const SCORE_PER_SURVIVE_SEC = 5
const SCORE_PER_EXHAUSTED = 1

/**
 * 無盡高分模式狀態機（引擎無關）：
 * - 不限制屁總量，但貓咪肚子會持續脹氣（0~100%）
 * - 主動按住放屁可洩壓並依等級與連放 Combo 賺分數
 * - 忍住不放到 100% 會觸發「強制大爆屁」（失控噴出超濃毒氣、斷 Combo）
 * - 每 20 秒升 1 級：屁越來越濃、脹氣越來越快、人類越走越快
 * - 懷疑值 >= 70 結束並結算最終分數
 */
export class GameLoop {
  private phase: GamePhase = 'playing'
  private elapsedSec = 0
  private bellyPressure = 20 // 開場略帶一點脹氣感
  private forcedBurstTimer = 0
  private holdFartSec = 0
  private fartPresses = 0
  private wasVoluntaryFarting = false
  private totalExhausted = 0
  private maxSuspicion = 0
  private rawScore = 0

  reset(): void {
    this.phase = 'playing'
    this.elapsedSec = 0
    this.bellyPressure = 20
    this.forcedBurstTimer = 0
    this.holdFartSec = 0
    this.fartPresses = 0
    this.wasVoluntaryFarting = false
    this.totalExhausted = 0
    this.maxSuspicion = 0
    this.rawScore = 0
  }

  isEnded(): boolean {
    return this.phase === 'lost'
  }

  isForcedBurst(): boolean {
    return this.forcedBurstTimer > 0
  }

  getDifficulty(): {
    level: number
    potencyMultiplier: number
    humanSpeedMultiplier: number
    humanActivityDuration: number
  } {
    const level = 1 + Math.floor(this.elapsedSec / LEVEL_INTERVAL_SEC)
    return {
      level,
      potencyMultiplier: 1 + (level - 1) * 0.25,
      humanSpeedMultiplier: 1 + Math.min(0.85, (level - 1) * 0.12),
      humanActivityDuration: Math.max(2.4, 5.0 - (level - 1) * 0.35),
    }
  }

  /**
   * 推進無盡模式狀態。
   * @param voluntaryFarting 玩家本幀是否主動放屁（已排除鎖定狀態）
   * @param currentSuspicion 目前人類懷疑值（0~100）
   * @param exhaustedDelta 本幀從門窗排出的粒子數
   * @param rawDt 幀間隔秒數
   */
  step(
    voluntaryFarting: boolean,
    currentSuspicion: number,
    exhaustedDelta: number,
    rawDt: number,
  ): GameLoopSnapshot {
    const dt = Math.min(Math.max(rawDt, 0), 0.05)
    if (this.phase === 'lost') {
      return this.getSnapshot()
    }

    this.elapsedSec += dt
    if (currentSuspicion > this.maxSuspicion) {
      this.maxSuspicion = currentSuspicion
    }

    if (exhaustedDelta > 0) {
      this.totalExhausted += exhaustedDelta
      this.rawScore += exhaustedDelta * SCORE_PER_EXHAUSTED
    }

    // 1. 懷疑值 >= 70 立即失敗結算
    if (currentSuspicion >= SUSPICION_THRESHOLD.caught) {
      this.phase = 'lost'
      this.wasVoluntaryFarting = false
      this.forcedBurstTimer = 0
      return this.getSnapshot()
    }

    const { level } = this.getDifficulty()
    this.rawScore += dt * SCORE_PER_SURVIVE_SEC

    // 2. 強制大爆屁狀態（肚子滿 100% 觸發）
    if (this.forcedBurstTimer > 0) {
      this.forcedBurstTimer = Math.max(0, this.forcedBurstTimer - dt)
      this.bellyPressure = Math.max(20, this.bellyPressure - FORCED_BURST_DRAIN_PER_SEC * dt)
      this.holdFartSec = 0
      this.wasVoluntaryFarting = false
      return this.getSnapshot()
    }

    // 3. 正常遊玩：主動放屁洩壓＋計分，否則自然脹氣
    if (voluntaryFarting) {
      if (!this.wasVoluntaryFarting) {
        this.fartPresses++
      }
      this.wasVoluntaryFarting = true
      this.holdFartSec += dt
      this.bellyPressure = Math.max(0, this.bellyPressure - VOLUNTARY_DRAIN_PER_SEC * dt)

      const combo = this.computeCombo()
      this.rawScore += dt * SCORE_PER_FART_SEC * level * combo
    } else {
      this.wasVoluntaryFarting = false
      this.holdFartSec = 0
      const riseRate = BASE_PRESSURE_RISE + (level - 1) * PRESSURE_RISE_PER_LEVEL
      this.bellyPressure = Math.min(100, this.bellyPressure + riseRate * dt)

      // 脹到 100% → 忍不住原地強制大爆屁！
      if (this.bellyPressure >= 100) {
        this.forcedBurstTimer = FORCED_BURST_DURATION
      }
    }

    return this.getSnapshot()
  }

  getSnapshot(): GameLoopSnapshot {
    const diff = this.getDifficulty()
    return {
      phase: this.phase,
      elapsedSec: this.elapsedSec,
      level: diff.level,
      potencyMultiplier: diff.potencyMultiplier,
      humanSpeedMultiplier: diff.humanSpeedMultiplier,
      humanActivityDuration: diff.humanActivityDuration,
      bellyPressure: this.bellyPressure,
      isForcedBurst: this.forcedBurstTimer > 0,
      forcedBurstRemaining: this.forcedBurstTimer,
      comboMultiplier: this.computeCombo(),
      fartPresses: this.fartPresses,
      totalExhausted: this.totalExhausted,
      maxSuspicion: this.maxSuspicion,
      score: Math.round(this.rawScore),
    }
  }

  private computeCombo(): number {
    // 連續按住放屁每多 1 秒 +0.5x，最高 3.0x
    return Math.min(3.0, 1.0 + this.holdFartSec * 0.5)
  }
}
