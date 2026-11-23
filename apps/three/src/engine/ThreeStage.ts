import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js'
import {
  ENTITY_SPECS,
  GRID,
  LEVEL_01,
  ROOM_SIZE,
  isInBounds,
  loadLevel,
  type EntityKind,
  type LoadedLevel,
} from '@toot/sim-core'
import { createGrayboxMesh } from './grayboxMeshes'

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
}

/**
 * Three.js 場景外殼：renderer / camera / 16×10×16 房間 / 格線 / 灰盒物件 / WebXR。
 * 主迴圈與模擬資料不放進 Vue 響應式，只透過 callback 節流同步 HUD。
 */
export class ThreeStage {
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera: THREE.PerspectiveCamera
  private readonly controls: OrbitControls
  private readonly vrButton: HTMLElement
  private readonly resizeObserver: ResizeObserver

  private readonly level: LoadedLevel
  private readonly entityGroup = new THREE.Group()
  private readonly gridHelperGroup = new THREE.Group()
  private readonly hoverTile: THREE.Mesh

  private readonly raycaster = new THREE.Raycaster()
  private readonly pointerNdc = new THREE.Vector2()
  private readonly floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  private readonly hitPoint = new THREE.Vector3()

  private lastHoverKey = ''
  private lastStatsTime = 0

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
    this.camera.position.set(ROOM_SIZE.width + 6, ROOM_SIZE.height + 5, ROOM_SIZE.depth + 7)

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.target.set(ROOM_SIZE.width / 2, ROOM_SIZE.height * 0.25, ROOM_SIZE.depth / 2)
    this.controls.enableDamping = true
    this.controls.mouseButtons = {
      LEFT: null as unknown as THREE.MOUSE,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.ROTATE,
    }
    this.controls.update()

    this.scene.background = new THREE.Color(0x0f172a)

    this.level = loadLevel(LEVEL_01)

    this.buildLights()
    this.buildRoom()
    this.buildGridHelpers()
    this.hoverTile = this.buildHoverTile()
    this.scene.add(this.hoverTile)

    this.scene.add(this.entityGroup)
    this.syncEntitiesFromGrid()

    this.renderer.domElement.addEventListener('pointermove', this.onPointerMove)
    this.renderer.domElement.addEventListener('pointerleave', this.onPointerLeave)

    this.resizeObserver = new ResizeObserver(() => this.onResize())
    this.resizeObserver.observe(container)

    this.renderer.setAnimationLoop(() => this.tick())
  }

  setGridVisible(visible: boolean): void {
    this.gridHelperGroup.visible = visible
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

    // BackSide 盒體：從房間外觀察時會自動隱藏前牆，不擋視線
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

    // 地板 16 × 16 格線
    const floorGrid = new THREE.GridHelper(width, GRID.NX, 0x64748b, 0x94a3b8)
    floorGrid.position.set(width / 2, 0.008, depth / 2)
    this.gridHelperGroup.add(floorGrid)

    // 16 × 10 × 16 空間邊界線框
    const roomWire = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(width, height, depth)),
      new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.45 }),
    )
    roomWire.position.set(width / 2, height / 2, depth / 2)
    this.gridHelperGroup.add(roomWire)

    // 原點座標軸提示（紅 X / 綠 Y / 藍 Z）
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
      this.entityGroup.add(createGrayboxMesh(entity))
    }
  }

  private readonly onPointerMove = (e: PointerEvent): void => {
    const rect = this.renderer.domElement.getBoundingClientRect()
    this.pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
    this.pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1

    this.raycaster.setFromCamera(this.pointerNdc, this.camera)
    if (!this.raycaster.ray.intersectPlane(this.floorPlane, this.hitPoint)) {
      this.clearHover()
      return
    }

    const cx = Math.floor(this.hitPoint.x)
    const cz = Math.floor(this.hitPoint.z)
    if (!isInBounds(cx, 0, cz)) {
      this.clearHover()
      return
    }

    this.hoverTile.position.set(cx + 0.5, 0.015, cz + 0.5)
    this.hoverTile.visible = true

    const key = `${cx},${cz}`
    if (key === this.lastHoverKey) return
    this.lastHoverKey = key

    const occupants = this.level.grid.getColumnEntities(cx, cz).map((ent) => ({
      id: ent.id,
      kind: ent.kind,
      label: ENTITY_SPECS[ent.kind].label,
    }))
    this.callbacks.onHoverCell?.({ x: cx, z: cz, occupants })
  }

  private readonly onPointerLeave = (): void => {
    this.clearHover()
  }

  private clearHover(): void {
    this.hoverTile.visible = false
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
    this.controls.update()
    this.renderer.render(this.scene, this.camera)

    const now = performance.now()
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
    this.renderer.domElement.removeEventListener('pointermove', this.onPointerMove)
    this.renderer.domElement.removeEventListener('pointerleave', this.onPointerLeave)
    this.resizeObserver.disconnect()
    this.controls.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
    this.vrButton.remove()
  }
}
