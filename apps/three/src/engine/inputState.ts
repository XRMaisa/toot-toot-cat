export interface RawControlSnapshot {
  /** 鏡頭右方（-1 ~ 1） */
  readonly right: number
  /** 鏡頭前方（-1 ~ 1） */
  readonly forward: number
  /** 本幀是否剛按下跳躍 */
  readonly jumpJustPressed: boolean
  /** 是否按住放屁 */
  readonly fartHeld: boolean
}

const PREVENT_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
])

/**
 * 整合鍵盤（方向鍵 / WASD / 空白鍵）、滑鼠左鍵跳躍與手機虛擬搖桿／按鈕。
 */
export class InputManager {
  private readonly keys = new Set<string>()
  private jumpQueued = false
  private virtualRight = 0
  private virtualForward = 0
  private virtualFart = false

  constructor(private readonly canvas: HTMLElement) {
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.onBlur)
    canvas.addEventListener('pointerdown', this.onCanvasPointerDown)
  }

  setVirtualMove(right: number, forward: number): void {
    this.virtualRight = right
    this.virtualForward = forward
  }

  triggerJump(): void {
    this.jumpQueued = true
  }

  setVirtualFart(held: boolean): void {
    this.virtualFart = held
  }

  /** 每幀讀取一次並清除一次性跳躍緩衝 */
  consumeSnapshot(): RawControlSnapshot {
    let keyRight = 0
    let keyForward = 0

    if (this.keys.has('ArrowRight') || this.keys.has('KeyD')) keyRight += 1
    if (this.keys.has('ArrowLeft') || this.keys.has('KeyA')) keyRight -= 1
    if (this.keys.has('ArrowUp') || this.keys.has('KeyW')) keyForward += 1
    if (this.keys.has('ArrowDown') || this.keys.has('KeyS')) keyForward -= 1

    const right = Math.max(-1, Math.min(1, keyRight + this.virtualRight))
    const forward = Math.max(-1, Math.min(1, keyForward + this.virtualForward))
    const jumpJustPressed = this.jumpQueued
    this.jumpQueued = false

    const fartHeld = this.keys.has('Space') || this.virtualFart

    return { right, forward, jumpJustPressed, fartHeld }
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (PREVENT_KEYS.has(e.code)) e.preventDefault()
    this.keys.add(e.code)
  }

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code)
  }

  private readonly onBlur = (): void => {
    this.keys.clear()
    this.virtualFart = false
    this.virtualRight = 0
    this.virtualForward = 0
  }

  private readonly onCanvasPointerDown = (e: PointerEvent): void => {
    // 電腦版滑鼠左鍵跳躍（僅限滑鼠，避免觸控拖曳視角誤跳）
    if (e.pointerType === 'mouse' && e.button === 0) {
      this.jumpQueued = true
    }
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('blur', this.onBlur)
    this.canvas.removeEventListener('pointerdown', this.onCanvasPointerDown)
  }
}
