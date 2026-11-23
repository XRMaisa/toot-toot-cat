import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js'
import { ROOM_SIZE } from '@toot/sim-core'

/**
 * Three.js 場景外殼：renderer / camera / 房間 / WebXR。
 * 主迴圈資料不放進 Vue 響應式，避免效能問題。
 */
export class ThreeStage {
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera: THREE.PerspectiveCamera
  private readonly controls: OrbitControls
  private readonly vrButton: HTMLElement
  private readonly resizeObserver: ResizeObserver

  constructor(private readonly container: HTMLElement) {
    const { clientWidth: w, clientHeight: h } = container

    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(w, h)
    this.renderer.shadowMap.enabled = true
    this.renderer.xr.enabled = true
    container.appendChild(this.renderer.domElement)

    this.vrButton = VRButton.createButton(this.renderer)
    container.appendChild(this.vrButton)

    this.camera = new THREE.PerspectiveCamera(50, w / h, 0.05, 100)
    this.camera.position.set(5, 4.5, 6)

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.target.set(0, ROOM_SIZE.height / 2, 0)
    this.controls.enableDamping = true

    this.scene.background = new THREE.Color(0x1e293b)
    this.buildRoom()

    this.resizeObserver = new ResizeObserver(() => this.onResize())
    this.resizeObserver.observe(container)

    this.renderer.setAnimationLoop(() => this.tick())
  }

  private buildRoom(): void {
    const { width, height, depth } = ROOM_SIZE

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.2))
    const sun = new THREE.DirectionalLight(0xffffff, 1.5)
    sun.position.set(3, 6, 2)
    sun.castShadow = true
    sun.shadow.mapSize.set(1024, 1024)
    this.scene.add(sun)

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(width, depth),
      new THREE.MeshStandardMaterial({ color: 0xf5deb3 }),
    )
    floor.rotation.x = -Math.PI / 2
    floor.receiveShadow = true
    this.scene.add(floor)

    const walls = new THREE.Mesh(
      new THREE.BoxGeometry(width, height, depth),
      new THREE.MeshStandardMaterial({ color: 0xfdf6e3, side: THREE.BackSide }),
    )
    walls.position.y = height / 2
    walls.receiveShadow = true
    this.scene.add(walls)

    // 佔位貓咪
    const cat = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 24, 16),
      new THREE.MeshStandardMaterial({ color: 0xffa94d }),
    )
    cat.position.set(0, 0.2, 0)
    cat.castShadow = true
    this.scene.add(cat)
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
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null)
    this.resizeObserver.disconnect()
    this.controls.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
    this.vrButton.remove()
  }
}
