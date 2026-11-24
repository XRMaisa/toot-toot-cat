import { SUSPICION_THRESHOLD } from './constants'
import type { LevelData } from './level'

export type GamePhase = 'playing' | 'safeCheck' | 'won' | 'lost'

export interface GameLoopSnapshot {
  readonly phase: GamePhase
  readonly elapsedSec: number
  readonly fartQuota: number
  readonly fartRemaining: number
  readonly fartProgress: number // 0 ~ 1（已放比例）
  readonly fartPresses: number
  readonly parTime: number
  readonly parPresses: number
  readonly maxSuspicion: number
  readonly safeCountdownSec: number
  readonly score: number
  readonly stars: 0 | 1 | 2 | 3
}

const FART_DRAIN_PER_SEC = 20 // 100 額度約需放滿 5 秒
const SAFE_CHECK_DURATION = 3.0 // 放完屁後需維持 3 秒安全

/**
 * 關卡循環狀態機（引擎無關）：
 * - 固定屁額度消耗、放屁次數統計、計時器
 * - 懷疑值 >= 70 立即失敗
 * - 屁額度歸零後進入 3 秒安全判定，撐過即過關
 * - 即時計算預估分數與最終星級
 */
export class GameLoop {
  private phase: GamePhase = 'playing'
  private elapsedSec = 0
  private fartRemaining: number
  private fartPresses = 0
  private wasFarting = false
  private maxSuspicion = 0
  private safeCountdownSec = SAFE_CHECK_DURATION

  constructor(private readonly level: LevelData) {
    this.fartRemaining = level.fartQuota
  }

  reset(): void {
    this.phase = 'playing'
    this.elapsedSec = 0
    this.fartRemaining = this.level.fartQuota
    this.fartPresses = 0
    this.wasFarting = false
    this.maxSuspicion = 0
    this.safeCountdownSec = SAFE_CHECK_DURATION
  }

  /** 目前是否允許貓咪繼續噴出臭氣粒子 */
  canEmitFart(): boolean {
    return this.phase === 'playing' && this.fartRemaining > 0
  }

  /** 遊戲是否已結束（過關或失敗） */
  isEnded(): boolean {
    return this.phase === 'won' || this.phase === 'lost'
  }

  /**
   * 推進關卡狀態。
   * @param actuallyFarting 貓咪本幀是否實際正在放屁（已排除鎖定狀態）
   * @param currentSuspicion 目前人類懷疑值（0~100）
   * @param rawDt 幀間隔秒數
   */
  step(actuallyFarting: boolean, currentSuspicion: number, rawDt: number): GameLoopSnapshot {
    const dt = Math.min(Math.max(rawDt, 0), 0.05)

    if (this.phase === 'won' || this.phase === 'lost') {
      return this.getSnapshot()
    }

    this.elapsedSec += dt
    if (currentSuspicion > this.maxSuspicion) {
      this.maxSuspicion = currentSuspicion
    }

    // 1. 懷疑值 >= 70 立即失敗
    if (currentSuspicion >= SUSPICION_THRESHOLD.caught) {
      this.phase = 'lost'
      this.wasFarting = false
      return this.getSnapshot()
    }

    // 2. 遊玩中：消耗屁額度並計算放屁次數
    if (this.phase === 'playing') {
      const emitting = actuallyFarting && this.fartRemaining > 0
      if (emitting && !this.wasFarting) {
        this.fartPresses++
      }
      this.wasFarting = emitting

      if (emitting) {
        this.fartRemaining = Math.max(0, this.fartRemaining - FART_DRAIN_PER_SEC * dt)
        if (this.fartRemaining <= 0) {
          this.phase = 'safeCheck'
          this.safeCountdownSec = SAFE_CHECK_DURATION
          this.wasFarting = false
        }
      }
    } else if (this.phase === 'safeCheck') {
      // 3. 放完屁後的 3 秒安全倒數
      this.safeCountdownSec = Math.max(0, this.safeCountdownSec - dt)
      if (this.safeCountdownSec <= 0) {
        this.phase = 'won'
      }
    }

    return this.getSnapshot()
  }

  getSnapshot(): GameLoopSnapshot {
    const score = this.computeScore()
    const stars = this.computeStars(score)
    const fartProgress =
      this.level.fartQuota > 0
        ? Math.min(1, Math.max(0, (this.level.fartQuota - this.fartRemaining) / this.level.fartQuota))
        : 1

    return {
      phase: this.phase,
      elapsedSec: this.elapsedSec,
      fartQuota: this.level.fartQuota,
      fartRemaining: this.fartRemaining,
      fartProgress,
      fartPresses: this.fartPresses,
      parTime: this.level.parTime,
      parPresses: this.level.parPresses,
      maxSuspicion: this.maxSuspicion,
      safeCountdownSec: this.safeCountdownSec,
      score,
      stars,
    }
  }

  private computeScore(): number {
    if (this.phase === 'lost') return 0
    const timeBonus = Math.max(0, this.level.parTime - this.elapsedSec) * 10
    const pressBonus = Math.max(0, this.level.parPresses - this.fartPresses) * 100
    const suspicionPenalty = this.maxSuspicion * 5
    return Math.max(0, Math.round(1000 + timeBonus + pressBonus - suspicionPenalty))
  }

  private computeStars(score: number): 0 | 1 | 2 | 3 {
    if (this.phase === 'lost') return 0
    if (score >= 1300) return 3
    if (score >= 950) return 2
    return 1
  }
}
