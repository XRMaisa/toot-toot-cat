import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js'
import {
  ENTITY_SPECS,
  GRID,
  LEVEL_01,
  ROOM_SIZE,
  SimulationWorld,
  isInBounds,
  type CatState,
  type DeviceId,
  type DeviceState,
  type EditorToolKind,
  type EntityKind,
  type GameLoopSnapshot,
  type GamePhase,
  type HumanState,
  type LevelData,
  type StinkSnapshot,
  type WorldFrame,
} from '@toot/sim-core'
import { DeviceVisuals } from './deviceMeshes'
import { disposeObject3D } from './dispose'
import { EditorOverlay } from './editorOverlay'
import {
  SHARED_GRAYBOX_MATERIALS,
  createCatMesh,
  createGrayboxMesh,
  createHumanMesh,
  type CatMeshRig,
  type HumanMeshRig,
} from './grayboxMeshes'
import { InputManager } from './inputState'
import { StinkVisuals } from './stinkVisuals'

export type EditorTool = EditorToolKind

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
  onDeviceState?: (state: DeviceState) => void
}

const WORLD_UP = new THREE.Vector3(0, 1, 0)

/**
 * Three.js 場景外殼：只負責 WebGL 渲染、鏡頭、燈光、輸入投影與視覺同步。
 * 所有模擬規則、5 系統編排與編輯器驗證全部委派給 @toot/sim-core 的 SimulationWorld。
 */
export class ThreeStage {
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera: THREE.PerspectiveCamera
  private readonly controls: OrbitControls
  private readonly vrButton: HTMLElement
  private readonly resizeObserver: ResizeObserver

  private readonly world = new SimulationWorld(LEVEL_01)
  private readonly editorOverlay = new EditorOverlay()
  private readonly deviceVisuals = new DeviceVisuals()
  private readonly stinkVisuals = new StinkVisuals()
  private readonly input: InputManager

  private catRig!: CatMeshRig
  private humanRig?: HumanMeshRig

  private readonly roomGroup = new THREE.Group()
  private readonly entityGroup = new THREE.Group()
  private readonly gridHelperGroup = new THREE.Group()
  private readonly hoverTile: THREE.Mesh

  private readonly raycaster = new THREE.Raycaster()
  private readonly pointerNdc = new THREE.Vector2()
  private readonly floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  private readonly hitPoint = new THREE.Vector3()
  private readonly camForward = new THREE.Vector3()
  private readonly camRight = new THREE.Vector3()
  private readonly prevCatPos = new THREE.Vector3()

  private lastHoverKey = ''
  private lastStatsTime = 0
  private lastHudTime = 0
  private lastFrameTime = performance.now()
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
    this.scene.add(
      this.roomGroup,
      this.gridHelperGroup,
      this.hoverTile,
      this.editorOverlay.ghostMesh,
      this.entityGroup,
      this.deviceVisuals.group,
      this.stinkVisuals.group,
    )

    this.syncLevelFromWorld(this.world.getFrame())

    this.renderer.domElement.addEventListener('pointermove', this.onPointerMove)
    this.renderer.domElement.addEventListener('pointerleave', this.onPointerLeave)
    this.renderer.domElement.addEventListener('pointerdown', this.onCanvasPointerDown)
    this.renderer.domElement.addEventListener('pointerup', this.onCanvasPointerUp)

    this.resizeObserver = new ResizeObserver(() => this.onResize())
    this.resizeObserver.observe(container)

    this.renderer.setAnimationLoop(() => this.tick())
  }

  restart(levelData?: LevelData): void {
    const frame = this.world.reset(levelData)
    this.syncLevelFromWorld(frame)
  }

  setEditorMode(enabled: boolean): void {
    this.editorOverlay.setActive(enabled)
    const frame = this.world.reset()
    this.syncLevelFromWorld(frame)

    if (enabled) {
      this.gridHelperGroup.visible = true
      this.focusOverviewCamera()
    }
  }

  setEditorTool(tool: EditorTool): void {
    this.editorOverlay.setTool(tool)
  }

  updateLevelMeta(meta: {
    name: string
    fartQuota: number
    parTime: number
    parPresses: number
  }): void {
    const updated = this.world.updateLevelMeta(meta)
    this.callbacks.onLevelChange?.(updated)
  }

  importLevel(data: LevelData): void {
    const frame = this.world.reset(data)
    this.syncLevelFromWorld(frame)
    if (this.editorOverlay.isActive) {
      this.focusOverviewCamera()
    }
  }

  setGridVisible(visible: boolean): void {
    this.gridHelperGroup.visible = visible
  }

  setHeatmapVisible(visible: boolean): void {
    this.stinkVisuals.setHeatmapVisible(visible)
  }

  toggleDevice(id: DeviceId): void {
    const next = this.world.toggleDevice(id)
    this.callbacks.onDeviceState?.(next)
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

  private focusOverviewCamera(): void {
    this.camera.position.set(ROOM_SIZE.width / 2, 19, ROOM_SIZE.depth + 8)
    this.controls.target.set(ROOM_SIZE.width / 2, 0.5, ROOM_SIZE.depth / 2)
    this.controls.update()
  }

  private syncLevelFromWorld(frame: WorldFrame): void {
    if (this.catRig) disposeObject3D(this.catRig.group, SHARED_GRAYBOX_MATERIALS)
    if (this.humanRig) {
      this.humanRig.dispose()
      disposeObject3D(this.humanRig.group, SHARED_GRAYBOX_MATERIALS)
    }
    this.clearEntities()

    this.catRig = createCatMesh(this.world.catEntity)
    this.humanRig = createHumanMesh(this.world.humanEntity)
    this.rebuildEntityMeshes()

    this.stinkVisuals.update(this.world.stink)
    this.deviceVisuals.update(frame.devices, 0)

    this.prevCatPos.set(frame.cat.position.x, frame.cat.position.y, frame.cat.position.z)
    this.lastPhase = frame.game.phase
    this.lastFrameTime = performance.now()

    if (!this.editorOverlay.isActive) {
      this.camera.position.set(
        frame.cat.position.x + 7,
        frame.cat.position.y + 7.5,
        frame.cat.position.z + 9,
      )
      this.controls.target.set(
        frame.cat.position.x,
        frame.cat.position.y + 0.8,
        frame.cat.position.z,
      )
      this.controls.update()
    }

    this.emitHudCallbacks(frame)
    this.callbacks.onLevelChange?.(this.world.getLevelData())
  }

  private clearEntities(): void {
    for (const child of this.entityGroup.children) {
      if (child === this.catRig?.group || child === this.humanRig?.group) continue
      disposeObject3D(child, SHARED_GRAYBOX_MATERIALS)
    }
    this.entityGroup.clear()
  }

  private rebuildEntityMeshes(): void {
    this.clearEntities()
    for (const entity of this.world.grid.getAllEntities()) {
      if (entity.id === this.world.catEntity.id) {
        this.catRig.group.position.set(entity.origin.x + 0.5, entity.origin.y, entity.origin.z + 0.5)
        this.entityGroup.add(this.catRig.group)
      } else if (entity.id === this.world.humanEntity.id && this.humanRig) {
        this.humanRig.group.position.set(entity.origin.x + 0.5, entity.origin.y, entity.origin.z + 0.5)
        this.entityGroup.add(this.humanRig.group)
      } else {
        this.entityGroup.add(createGrayboxMesh(entity))
      }
    }
  }

  private emitHudCallbacks(frame: WorldFrame): void {
    this.callbacks.onCatState?.(frame.cat)
    this.callbacks.onHumanState?.(frame.human)
    this.callbacks.onStinkState?.(frame.stink)
    this.callbacks.onGameState?.(frame.game)
    this.callbacks.onDeviceState?.(frame.devices)
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
    this.scene.add(sun, sun.target)
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
    this.roomGroup.add(floor)

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
    this.roomGroup.add(walls)
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

  private readonly onCanvasPointerDown = (e: PointerEvent): void => {
    const changed = this.editorOverlay.handlePointerDown(e, this.pickFloorCell(e), this.world)
    if (changed) {
      this.rebuildEntityMeshes()
      this.callbacks.onLevelChange?.(this.world.getLevelData())
    }
  }

  private readonly onCanvasPointerUp = (e: PointerEvent): void => {
    const changed = this.editorOverlay.handlePointerUp(e, this.pickFloorCell(e), this.world)
    if (changed) {
      this.rebuildEntityMeshes()
      this.callbacks.onLevelChange?.(this.world.getLevelData())
    }
  }

  private readonly onPointerMove = (e: PointerEvent): void => {
    const cell = this.pickFloorCell(e)
    if (!cell) {
      this.clearHover()
      return
    }

    if (this.editorOverlay.isActive) {
      this.hoverTile.visible = false
      this.editorOverlay.updateGhost(this.world, cell.x, cell.z)
    } else {
      this.editorOverlay.hide()
      this.hoverTile.position.set(cell.x + 0.5, 0.015, cell.z + 0.5)
      this.hoverTile.visible = true
    }

    const key = `${cell.x},${cell.z}`
    if (key === this.lastHoverKey) return
    this.lastHoverKey = key

    const occupants = this.world.grid.getColumnEntities(cell.x, cell.z).map((ent) => ({
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
    this.editorOverlay.hide()
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
    const dt = (now - this.lastFrameTime) / 1000
    this.lastFrameTime = now

    if (this.editorOverlay.isActive || this.world.isEnded()) {
      this.controls.update()
      this.renderer.render(this.scene, this.camera)
      return
    }

    // 1. 依鏡頭方向投影操作輸入
    this.camera.getWorldDirection(this.camForward)
    this.camForward.y = 0
    if (this.camForward.lengthSq() < 1e-6) {
      this.camForward.set(0, 0, -1)
    } else {
      this.camForward.normalize()
    }
    this.camRight.crossVectors(this.camForward, WORLD_UP).normalize()

    const raw = this.input.consumeSnapshot()
    const frame = this.world.step(
      {
        moveX: this.camForward.x * raw.forward + this.camRight.x * raw.right,
        moveZ: this.camForward.z * raw.forward + this.camRight.z * raw.right,
        jumpJustPressed: raw.jumpJustPressed,
        fartHeld: raw.fartHeld,
      },
      dt,
    )

    // 2. 將 WorldFrame 同步到 Three.js 視覺層
    const { x, y, z } = frame.cat.position
    this.catRig.group.position.set(x, y, z)
    this.catRig.group.rotation.y = frame.cat.facingYaw
    this.catRig.setFarting(frame.cat.isFarting)

    this.humanRig?.updateState(frame.human, frame.timeSec)
    this.humanRig?.setAlert(frame.stink.alertLevel)
    this.deviceVisuals.update(frame.devices, dt)
    this.stinkVisuals.update(this.world.stink)

    // 3. 鏡頭跟隨貓咪
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

    // 4. 節流同步 HUD
    const phaseChanged = frame.game.phase !== this.lastPhase
    this.lastPhase = frame.game.phase
    if (phaseChanged || now - this.lastHudTime >= 100) {
      this.lastHudTime = now
      this.emitHudCallbacks(frame)
    }

    if (now - this.lastStatsTime >= 250) {
      this.lastStatsTime = now
      this.callbacks.onStats?.({
        entityCount: this.world.grid.getAllEntities().length,
        drawCalls: this.renderer.info.render.calls,
        triangles: this.renderer.info.render.triangles,
      })
    }
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null)
    this.input.dispose()
    this.stinkVisuals.dispose()
    this.deviceVisuals.dispose()
    this.editorOverlay.dispose()
    this.humanRig?.dispose()
    disposeObject3D(this.entityGroup, SHARED_GRAYBOX_MATERIALS)
    disposeObject3D(this.roomGroup)
    disposeObject3D(this.gridHelperGroup)
    disposeObject3D(this.hoverTile)
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
