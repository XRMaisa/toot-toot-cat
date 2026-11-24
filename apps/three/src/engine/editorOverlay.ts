import * as THREE from 'three'
import {
  ENTITY_SPECS,
  type EditorToolKind,
  type SimulationWorld,
} from '@toot/sim-core'

/**
 * 關卡編輯器的 Three.js 互動外殼：
 * 管理紅／綠半透明預覽框（Ghost Mesh）與滑鼠左鍵放置／右鍵輕點刪除，
 * 實際規則全部委派給 sim-core 的 SimulationWorld。
 */
export class EditorOverlay {
  readonly ghostMesh: THREE.Mesh
  private readonly ghostMat: THREE.MeshBasicMaterial
  private active = false
  private tool: EditorToolKind = 'bed'
  private rightDownScreen = { x: 0, y: 0 }

  constructor() {
    this.ghostMat = new THREE.MeshBasicMaterial({
      color: 0x22c55e,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    })
    this.ghostMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.ghostMat)
    this.ghostMesh.visible = false
  }

  get isActive(): boolean {
    return this.active
  }

  setActive(enabled: boolean): void {
    this.active = enabled
    if (!enabled) this.ghostMesh.visible = false
  }

  setTool(tool: EditorToolKind): void {
    this.tool = tool
  }

  hide(): void {
    this.ghostMesh.visible = false
  }

  updateGhost(world: SimulationWorld, cx: number, cz: number): void {
    if (!this.active) {
      this.ghostMesh.visible = false
      return
    }
    const valid = world.canApplyEditorTool(this.tool, cx, cz)
    if (this.tool === 'erase') {
      this.ghostMesh.scale.set(1, 0.15, 1)
      this.ghostMesh.position.set(cx + 0.5, 0.08, cz + 0.5)
      this.ghostMat.color.setHex(valid ? 0xf43f5e : 0x64748b)
    } else {
      const { x: sx, y: sy, z: sz } = ENTITY_SPECS[this.tool].size
      this.ghostMesh.scale.set(sx, sy, sz)
      this.ghostMesh.position.set(cx + sx / 2, sy / 2, cz + sz / 2)
      this.ghostMat.color.setHex(valid ? 0x22c55e : 0xef4444)
    }
    this.ghostMesh.visible = true
  }

  /** 處理滑鼠按下：左鍵套用工具、右鍵記錄起始點以區分拖曳與輕點 */
  handlePointerDown(
    e: PointerEvent,
    cell: { x: number; z: number } | null,
    world: SimulationWorld,
  ): boolean {
    if (!this.active) return false
    if (e.button === 2) {
      this.rightDownScreen = { x: e.clientX, y: e.clientY }
      return false
    }
    if (e.button === 0 && cell) {
      const changed = world.applyEditorTool(this.tool, cell.x, cell.z)
      this.updateGhost(world, cell.x, cell.z)
      return changed
    }
    return false
  }

  /** 處理右鍵放開：若未拖曳旋轉視角（< 5px），視為快速刪除該格家具 */
  handlePointerUp(
    e: PointerEvent,
    cell: { x: number; z: number } | null,
    world: SimulationWorld,
  ): boolean {
    if (!this.active || e.button !== 2 || !cell) return false
    const dragDist = Math.hypot(
      e.clientX - this.rightDownScreen.x,
      e.clientY - this.rightDownScreen.y,
    )
    if (dragDist >= 5) return false
    const changed = world.eraseFurnitureAt(cell.x, cell.z)
    this.updateGhost(world, cell.x, cell.z)
    return changed
  }

  dispose(): void {
    this.ghostMesh.geometry.dispose()
    this.ghostMat.dispose()
  }
}
