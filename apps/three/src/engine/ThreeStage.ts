import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js'
import {
  CatController,
  ENTITY_SPECS,
  GRID,
  GameLoop,
  HumanController,
  LEVEL_01,
  ROOM_SIZE,
  StinkSystem,
  defaultFootprint,
  isInBounds,
  loadLevel,
  type CatState,
  type EntityKind,
  type FurnitureKind,
  type GameLoopSnapshot,
  type GamePhase,
  type HumanState,
  type LevelData,
  type LoadedLevel,
  type StinkSnapshot,
} from '@toot/sim-core'
import {
  createCatMesh,
  createGrayboxMesh,
  createHumanMesh,
  type CatMeshRig,
  type HumanMeshRig,
} from './grayboxMeshes'
import { InputManager } from './inputState'
import { StinkVisuals } from './stinkVisuals'

export type EditorTool = EntityKind | 'erase'

export interface HoverCellInfo {
  readonly x: number
  readonly z: number
  readonly occupants: ReadonlyArray<{
    readonly id: number
    readonly kind: EntityKind
    readonly label: string
  }>
}

export interface StageStats {
  readonly entityCount: number
  readonly drawCalls: number
  readonly triangles: number
}

export interface ThreeStageCallbacks {
  onHoverCell?: (info: HoverCellInfo | null) => void
  onStats?: (stats: StageStats) => void
  onCatState?: (state: CatState) => void
  onHumanState?: (state: HumanState) => void
  onStinkState?: (snapshot: StinkSnapshot) => void
  onGameState?: (snapshot: GameLoopSnapshot) => void
  onLevelChange?: (level: LevelData) => void
}

const WORLD_UP = new THREE.Vector3(0, 1, 0)

/**
 * Three.js 場景外殼：房間 / 灰盒物件 / 貓咪控制 / 人類 AI / 臭氣粒子 / 關卡循環 / 關卡編輯器 / WebXR。
 * 主迴圈與模擬資料不放進 Vue 響應式，只透過 callback 節流同步 HUD。
 */
export class ThreeStage {
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera: THREE.PerspectiveCamera
  private readonly controls: OrbitControls
  private readonly vrButton: HTMLElement
  private readonly resizeObserver: ResizeObserver

  private currentLevelData: LevelData = LEVEL_01
  private level!: LoadedLevel
  private catController!: CatController
  private humanController!: HumanController
  private gameLoop!: GameLoop
  private catRig!: CatMeshRig
  private humanRig?: HumanMeshRig
  private readonly stinkSystem = new StinkSystem()
  private readonly stinkVisuals = new StinkVisuals()
  private readonly input: InputManager

  private readonly entityGroup = new THREE.Group()
  private readonly gridHelperGroup = new THREE.Group()
  private readonly hoverTile: THREE.Mesh
  private readonly ghostMesh: THREE.Mesh
  private readonly ghostMat: THREE.MeshBasicMaterial

  private readonly raycaster = new THREE.Raycaster()
  private readonly pointerNdc = new THREE.Vector2()
  private readonly floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  private readonly hitPoint = new THREE.Vector3()
  private readonly camForward = new THREE.Vector3()
  private readonly camRight = new THREE.Vector3()

  private editorMode = false
  private editorTool: EditorTool = 'bed'
  private rightDownScreen = { x: 0, y: 0 }

  private lastHoverKey = ''
  private lastStatsTime = 0
  private lastHudTime = 0
  private lastFrameTime = performance.now()
  private prevCatPos = new THREE.Vector3()
  private lastCatGrounded = true
  private lastPhase: GamePhase = 'playing'

  constructor(
    private readonly container: HTMLElement,
    private readonly callbacks: ThreeStageCallbacks = {},
  ) {
    const { clientWidth: w, clientHeight: h } = container

    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(w, h)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.xr.enabled = true
    container.appendChild(this.renderer.domElement)

    this.vrButton = VRButton.createButton(this.renderer)
    container.appendChild(this.vrButton)

    this.camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 150)
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.minDistance = 4
    this.controls.maxDistance = 36
    this.controls.maxPolarAngle = Math.PI * 0.48
    this.controls.mouseButtons = {
      LEFT: null as unknown as THREE.MOUSE,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.ROTATE,
    }

    this.input = new InputManager(this.renderer.domElement)
    this.scene.background = new THREE.Color(0x0f172a)

    this.buildLights()
    this.buildRoom()
    this.buildGridHelpers()
    this.hoverTile = this.buildHoverTile()
    this.scene.add(this.hoverTile)

    this.ghostMat = new THREE.MeshBasicMaterial({
      color: 0x22c55e,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    })
    this.ghostMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.ghostMat)
    this.ghostMesh.visible = false
    this.scene.add(this.ghostMesh)

    this.scene.add(this.entityGroup)
    this.scene.add(this.stinkVisuals.group)

    this.initLevel(LEVEL_01)

    this.renderer.domElement.addEventListener('pointermove', this.onPointerMove)
    this.renderer.domElement.addEventListener('pointerleave', this.onPointerLeave)
    this.renderer.domElement.addEventListener('pointerdown', this.onCanvasPointerDown)
    this.renderer.domElement.addEventListener('pointerup', this.onCanvasPointerUp)

    this.resizeObserver = new ResizeObserver(() => this.onResize())
    this.resizeObserver.observe(container)

    this.renderer.setAnimationLoop(() => this.tick())
  }

  /** 重新開始目前關卡（或載入新的關卡資料） */
  restart(levelData?: LevelData): void {
    this.initLevel(levelData ?? this.currentLevelData)
  }

  /** 切換遊玩模式 / 極簡關卡編輯模式 */
  setEditorMode(enabled: boolean): void {
    this.editorMode = enabled
    this.ghostMesh.visible = false
    this.initLevel(this.currentLevelData)

    if (enabled) {
      this.gridHelperGroup.visible = true
      this.camera.position.set(ROOM_SIZE.width / 2, 19, ROOM_SIZE.depth + 8)
      this.controls.target.set(ROOM_SIZE.width / 2, 0.5, ROOM_SIZE.depth / 2)
      this.controls.update()
    }
  }

  setEditorTool(tool: EditorTool): void {
    this.editorTool = tool
  }

  updateLevelMeta(meta: {
    name: string
    fartQuota: number
    parTime: number
    parPresses: number
  }): void {
    this.currentLevelData = {
      ...this.currentLevelData,
      name: meta.name,
      fartQuota: meta.fartQuota,
      parTime: meta.parTime,
      parPresses: meta.parPresses,
    }
    this.callbacks.onLevelChange?.(this.currentLevelData)
  }

  importLevel(data: LevelData): void {
    this.currentLevelData = data
    this.initLevel(data)
    if (this.editorMode) {
      this.camera.position.set(ROOM_SIZE.width / 2, 19, ROOM_SIZE.depth + 8)
      this.controls.target.set(ROOM_SIZE.width / 2, 0.5, ROOM_SIZE.depth / 2)
      this.controls.update()
    }
  }

  setGridVisible(visible: boolean): void {
    this.gridHelperGroup.visible = visible
  }

  setHeatmapVisible(visible: boolean): void {
    this.stinkVisuals.setHeatmapVisible(visible)
  }

  setVirtualMove(right: number, forward: number): void {
    this.input.setVirtualMove(right, forward)
  }

  triggerJump(): void {
    this.input.triggerJump()
  }

  setVirtualFart(held: boolean): void {
    this.input.setVirtualFart(held)
  }

  private initLevel(data: LevelData): void {
    this.currentLevelData = data
    this.humanRig?.dispose()

    this.level = loadLevel(data)
    this.catController = new CatController(this.level.grid, this.level.cat)
    this.humanController = new HumanController(
      this.level.grid,
      this.level.human,
      this.level.cat,
    )
    this.gameLoop = new GameLoop(data)
    this.stinkSystem.reset()
    this.stinkVisuals.update(this.stinkSystem)

    this.catRig = createCatMesh(this.level.cat)
    this.humanRig = createHumanMesh(this.level.human)
    this.syncEntitiesFromGrid()

    const initialCat = this.catController.getState()
    const initialHuman = this.humanController.getState()
    const initialGame = this.gameLoop.getSnapshot()

    this.prevCatPos.set(initialCat.position.x, initialCat.position.y, initialCat.position.z)
    this.lastCatGrounded = true
    this.lastPhase = initialGame.phase
    this.lastFrameTime = performance.now()

    if (!this.editorMode) {
      this.camera.position.set(
        initialCat.position.x + 7,
        initialCat.position.y + 7.5,
        initialCat.position.z + 9,
      )
      this.controls.target.set(
        initialCat.position.x,
        initialCat.position.y + 0.8,
        initialCat.position.z,
      )
      this.controls.update()
    }

    this.callbacks.onCatState?.(initialCat)
    this.callbacks.onHumanState?.(initialHuman)
    this.callbacks.onStinkState?.(this.stinkSystem.getSnapshot())
    this.callbacks.onGameState?.(initialGame)
    this.callbacks.onLevelChange?.(this.currentLevelData)
  }

  private buildLights(): void {
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x475569, 1.15))

    const sun = new THREE.DirectionalLight(0xffffff, 1.4)
    sun.position.set(ROOM_SIZE.width * 0.75, ROOM_SIZE.height * 1.9, ROOM_SIZE.depth * 0.85)
    sun.target.position.set(ROOM_SIZE.width / 2, 0, ROOM_SIZE.depth / 2)
    sun.castShadow = true
    sun.shadow.mapSize.set(1024, 1024)
    sun.shadow.camera.near = 1
    sun.shadow.camera.far = 45
    const extent = 12
    sun.shadow.camera.left = -extent
    sun.shadow.camera.right = extent
    sun.shadow.camera.top = extent
    sun.shadow.camera.bottom = -extent
    sun.shadow.bias = -0.0005
    this.scene.add(sun)
    this.scene.add(sun.target)
  }

  private buildRoom(): void {
    const { width, height, depth } = ROOM_SIZE

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(width, depth),
      new THREE.MeshStandardMaterial({ color: 0xf5deb3, roughness: 0.9 }),
    )
    floor.rotation.x = -Math.PI / 2
    floor.position.set(width / 2, 0, depth / 2)
    floor.receiveShadow = true
    this.scene.add(floor)

    const walls = new THREE.Mesh(
      new THREE.BoxGeometry(width, height, depth),
      new THREE.MeshStandardMaterial({
        color: 0xfdf6e3,
        roughness: 0.95,
        side: THREE.BackSide,
      }),
    )
    walls.position.set(width / 2, height / 2, depth / 2)
    walls.receiveShadow = true
    this.scene.add(walls)
  }

  private buildGridHelpers(): void {
    const { width, height, depth } = ROOM_SIZE

    const floorGrid = new THREE.GridHelper(width, GRID.NX, 0x64748b, 0x94a3b8)
    floorGrid.position.set(width / 2, 0.008, depth / 2)
    this.gridHelperGroup.add(floorGrid)

    const roomWire = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(width, height, depth)),
      new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.45 }),
    )
    roomWire.position.set(width / 2, height / 2, depth / 2)
    this.gridHelperGroup.add(roomWire)

    const axes = new THREE.AxesHelper(2.2)
    axes.position.set(0, 0.02, 0)
    this.gridHelperGroup.add(axes)

    this.scene.add(this.gridHelperGroup)
  }

  private buildHoverTile(): THREE.Mesh {
    const tile = new THREE.Mesh(
      new THREE.PlaneGeometry(0.96, 0.96),
      new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
      }),
    )
    tile.rotation.x = -Math.PI / 2
    tile.position.y = 0.015
    tile.visible = false
    return tile
  }

  private syncEntitiesFromGrid(): void {
    this.entityGroup.clear()
    for (const entity of this.level.grid.getAllEntities()) {
      if (entity.id === this.level.cat.id) {
        this.entityGroup.add(this.catRig.group)
      } else if (entity.id === this.level.human.id && this.humanRig) {
        this.entityGroup.add(this.humanRig.group)
      } else {
        this.entityGroup.add(createGrayboxMesh(entity))
      }
    }
  }

  private pickFloorCell(e: PointerEvent): { x: number; z: number } | null {
    const rect = this.renderer.domElement.getBoundingClientRect()
    this.pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
    this.pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1

    this.raycaster.setFromCamera(this.pointerNdc, this.camera)
    if (!this.raycaster.ray.intersectPlane(this.floorPlane, this.hitPoint)) {
      return null
    }
    const cx = Math.floor(this.hitPoint.x)
    const cz = Math.floor(this.hitPoint.z)
    return isInBounds(cx, 0, cz) ? { x: cx, z: cz } : null
  }

  private canApplyEditorTool(cx: number, cz: number): boolean {
    if (this.editorTool === 'erase') {
      const target = this.level.grid.getEntityAt(cx, 0, cz)
      return Boolean(target && target.kind !== 'cat' && target.kind !== 'human')
    }
    const ignoreId =
      this.editorTool === 'cat'
        ? this.level.cat.id
        : this.editorTool === 'human'
          ? this.level.human.id
          : 0
    return this.level.grid.canPlace(
      { x: cx, y: 0, z: cz },
      defaultFootprint(this.editorTool),
      ignoreId,
    )
  }

  private updateEditorGhost(cx: number, cz: number): void {
    const valid = this.canApplyEditorTool(cx, cz)
    if (this.editorTool === 'erase') {
      this.ghostMesh.scale.set(1, 0.15, 1)
      this.ghostMesh.position.set(cx + 0.5, 0.08, cz + 0.5)
      this.ghostMat.color.setHex(valid ? 0xf43f5e : 0x64748b)
    } else {
      const { x: sx, y: sy, z: sz } = ENTITY_SPECS[this.editorTool].size
      this.ghostMesh.scale.set(sx, sy, sz)
      this.ghostMesh.position.set(cx + sx / 2, sy / 2, cz + sz / 2)
      this.ghostMat.color.setHex(valid ? 0x22c55e : 0xef4444)
    }
    this.ghostMesh.visible = true
  }

  private rebuildLevelDataFromGrid(): void {
    const furniture: Array<{ type: FurnitureKind; x: number; z: number }> = []
    for (const ent of this.level.grid.getAllEntities()) {
      if (ent.kind === 'bed' || ent.kind === 'desk' || ent.kind === 'chair') {
        furniture.push({ type: ent.kind, x: ent.origin.x, z: ent.origin.z })
      }
    }
    this.currentLevelData = {
      ...this.currentLevelData,
      furniture,
      cat: { x: this.level.cat.origin.x, z: this.level.cat.origin.z },
      human: { x: this.level.human.origin.x, z: this.level.human.origin.z },
    }
    this.callbacks.onLevelChange?.(this.currentLevelData)
  }

  private eraseFurnitureAt(cx: number, cz: number): void {
    const target = this.level.grid.getEntityAt(cx, 0, cz)
    if (!target || target.kind === 'cat' || target.kind === 'human') return
    this.level.grid.remove(target.id)
    this.syncEntitiesFromGrid()
    this.rebuildLevelDataFromGrid()
  }

  private applyEditorToolAt(cx: number, cz: number): void {
    if (this.editorTool === 'erase') {
      this.eraseFurnitureAt(cx, cz)
      return
    }
    if (!this.canApplyEditorTool(cx, cz)) return

    if (this.editorTool === 'cat') {
      if (this.level.grid.move(this.level.cat.id, { x: cx, y: 0, z: cz })) {
        this.catRig.group.position.set(cx + 0.5, 0, cz + 0.5)
        this.rebuildLevelDataFromGrid()
      }
    } else if (this.editorTool === 'human') {
      if (this.level.grid.move(this.level.human.id, { x: cx, y: 0, z: cz })) {
        this.humanRig?.group.position.set(cx + 0.5, 0, cz + 0.5)
        this.rebuildLevelDataFromGrid()
      }
    } else {
      if (this.level.grid.place(this.editorTool, { x: cx, y: 0, z: cz })) {
        this.syncEntitiesFromGrid()
        this.rebuildLevelDataFromGrid()
      }
    }
  }

  private readonly onCanvasPointerDown = (e: PointerEvent): void => {
    if (!this.editorMode) return
    if (e.button === 2) {
      this.rightDownScreen = { x: e.clientX, y: e.clientY }
      return
    }
    if (e.button === 0) {
      const cell = this.pickFloorCell(e)
      if (cell) {
        this.applyEditorToolAt(cell.x, cell.z)
        this.updateEditorGhost(cell.x, cell.z)
      }
    }
  }

  private readonly onCanvasPointerUp = (e: PointerEvent): void => {
    if (!this.editorMode || e.button !== 2) return
    // 右鍵輕點（未拖曳旋轉視角）→ 快速刪除該格家具
    const dragDist = Math.hypot(
      e.clientX - this.rightDownScreen.x,
      e.clientY - this.rightDownScreen.y,
    )
    if (dragDist < 5) {
      const cell = this.pickFloorCell(e)
      if (cell) {
        this.eraseFurnitureAt(cell.x, cell.z)
        this.updateEditorGhost(cell.x, cell.z)
      }
    }
  }

  private readonly onPointerMove = (e: PointerEvent): void => {
    const cell = this.pickFloorCell(e)
    if (!cell) {
      this.clearHover()
      return
    }

    if (this.editorMode) {
      this.hoverTile.visible = false
      this.updateEditorGhost(cell.x, cell.z)
    } else {
      this.ghostMesh.visible = false
      this.hoverTile.position.set(cell.x + 0.5, 0.015, cell.z + 0.5)
      this.hoverTile.visible = true
    }

    const key = `${cell.x},${cell.z}`
    if (key === this.lastHoverKey) return
    this.lastHoverKey = key

    const occupants = this.level.grid.getColumnEntities(cell.x, cell.z).map((ent) => ({
      id: ent.id,
      kind: ent.kind,
      label: ENTITY_SPECS[ent.kind].label,
    }))
    this.callbacks.onHoverCell?.({ x: cell.x, z: cell.z, occupants })
  }

  private readonly onPointerLeave = (): void => {
    this.clearHover()
  }

  private clearHover(): void {
    this.hoverTile.visible = false
    this.ghostMesh.visible = false
    if (this.lastHoverKey !== '') {
      this.lastHoverKey = ''
      this.callbacks.onHoverCell?.(null)
    }
  }

  private onResize(): void {
    const { clientWidth: w, clientHeight: h } = this.container
    if (w === 0 || h === 0) return
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h)
  }

  private tick(): void {
    const now = performance.now()
    const timeSec = now / 1000
    const dt = (now - this.lastFrameTime) / 1000
    this.lastFrameTime = now

    // 編輯模式或遊戲結束時僅更新鏡頭與渲染，暫停模擬
    if (this.editorMode || this.gameLoop.isEnded()) {
      this.controls.update()
      this.renderer.render(this.scene, this.camera)
      return
    }

    // 1. 更新人類 AI
    const humanState = this.humanController.step(this.prevCatPos, this.lastCatGrounded, dt)
    const isBeingPetted = humanState.petCatHoldPos !== null

    if (humanState.petCatHoldPos) {
      const petBounce = Math.abs(Math.sin(timeSec * 18)) * 0.05
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

    // 2. 鏡頭投影方向
    this.camera.getWorldDirection(this.camForward)
    this.camForward.y = 0
    if (this.camForward.lengthSq() < 1e-6) {
      this.camForward.set(0, 0, -1)
    } else {
      this.camForward.normalize()
    }
    this.camRight.crossVectors(this.camForward, WORLD_UP).normalize()

    // 3. 更新貓咪
    const raw = this.input.consumeSnapshot()
    const moveX = this.camForward.x * raw.forward + this.camRight.x * raw.right
    const moveZ = this.camForward.z * raw.forward + this.camRight.z * raw.right

    const catState = this.catController.step(
      {
        moveX,
        moveZ,
        jumpJustPressed: raw.jumpJustPressed,
        fartHeld: raw.fartHeld && this.gameLoop.canEmitFart(),
        locked: isBeingPetted,
      },
      dt,
    )
    this.lastCatGrounded = catState.grounded

    const { x, y, z } = catState.position
    this.catRig.group.position.set(x, y, z)
    this.catRig.group.rotation.y = catState.facingYaw
    this.catRig.setFarting(catState.isFarting)

    // 4. 更新人類外觀姿勢
    this.humanRig?.updateState(humanState, timeSec)

    // 5. 更新臭氣粒子與頭部吸入
    const backX = -Math.sin(catState.facingYaw)
    const backZ = -Math.cos(catState.facingYaw)
    const stinkSnapshot = this.stinkSystem.step(
      this.level.grid,
      {
        active: catState.isFarting,
        x: x + backX * 0.44,
        y: y + 0.36,
        z: z + backZ * 0.44,
        dirX: backX,
        dirZ: backZ,
      },
      humanState.headCell,
      dt,
    )
    this.stinkVisuals.update(this.stinkSystem)
    this.humanRig?.setAlert(stinkSnapshot.alertLevel)

    // 6. 更新關卡循環
    const gameSnapshot = this.gameLoop.step(catState.isFarting, stinkSnapshot.suspicion, dt)

    // 7. 鏡頭跟隨貓咪
    const dx = x - this.prevCatPos.x
    const dy = y - this.prevCatPos.y
    const dz = z - this.prevCatPos.z
    this.controls.target.x += dx
    this.controls.target.y += dy
    this.controls.target.z += dz
    this.camera.position.x += dx
    this.camera.position.y += dy
    this.camera.position.z += dz
    this.prevCatPos.set(x, y, z)

    this.controls.update()
    this.renderer.render(this.scene, this.camera)

    // 8. 節流同步 HUD
    const phaseChanged = gameSnapshot.phase !== this.lastPhase
    this.lastPhase = gameSnapshot.phase

    if (phaseChanged || now - this.lastHudTime >= 100) {
      this.lastHudTime = now
      this.callbacks.onCatState?.(catState)
      this.callbacks.onHumanState?.(humanState)
      this.callbacks.onStinkState?.(stinkSnapshot)
      this.callbacks.onGameState?.(gameSnapshot)
    }

    if (now - this.lastStatsTime >= 250) {
      this.lastStatsTime = now
      this.callbacks.onStats?.({
        entityCount: this.level.grid.getAllEntities().length,
        drawCalls: this.renderer.info.render.calls,
        triangles: this.renderer.info.render.triangles,
      })
    }
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null)
    this.input.dispose()
    this.stinkVisuals.dispose()
    this.humanRig?.dispose()
    this.ghostMesh.geometry.dispose()
    this.ghostMat.dispose()
    this.renderer.domElement.removeEventListener('pointermove', this.onPointerMove)
    this.renderer.domElement.removeEventListener('pointerleave', this.onPointerLeave)
    this.renderer.domElement.removeEventListener('pointerdown', this.onCanvasPointerDown)
    this.renderer.domElement.removeEventListener('pointerup', this.onCanvasPointerUp)
    this.resizeObserver.disconnect()
    this.controls.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
    this.vrButton.remove()
  }
}
