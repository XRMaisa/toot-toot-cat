import * as THREE from 'three'
import { DEVICE_LAYOUT, type DeviceState } from '@toot/sim-core'
import { disposeObject3D } from './dispose'

/**
 * 房間 5 項可動 IoT 設備的 3D 模型（電風扇、冷氣、電腦主機、窗戶、門）。
 * 依效能紅線：互動／可動部位獨立拆出方便旋轉與狀態動畫。
 */
export class DeviceVisuals {
  readonly group = new THREE.Group()

  private readonly fanHead = new THREE.Group()
  private readonly fanBlades = new THREE.Group()
  private readonly fanLedMat: THREE.MeshBasicMaterial

  private readonly acFlap: THREE.Mesh
  private readonly acLedMat: THREE.MeshBasicMaterial

  private readonly pcGlowMat: THREE.MeshBasicMaterial
  private readonly pcHeatPlume: THREE.Mesh

  private readonly windowSashPivot = new THREE.Group()
  private readonly doorLeafPivot = new THREE.Group()

  private windowAngle = 0
  private doorAngle = 0

  constructor() {
    // 1. 電風扇（立扇）
    const fanGroup = new THREE.Group()
    fanGroup.position.set(DEVICE_LAYOUT.fan.x, 0, DEVICE_LAYOUT.fan.z)

    const metalMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.45 })
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.46, 0.1, 16), metalMat)
    base.position.y = 0.05
    base.castShadow = true
    fanGroup.add(base)

    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 1.0, 10), metalMat)
    pole.position.y = 0.55
    pole.castShadow = true
    fanGroup.add(pole)

    this.fanHead.position.y = DEVICE_LAYOUT.fan.y
    const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.32, 12), metalMat)
    motor.rotation.x = Math.PI / 2
    this.fanHead.add(motor)

    const guard = new THREE.Mesh(
      new THREE.TorusGeometry(0.42, 0.03, 8, 24),
      new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.5 }),
    )
    guard.position.z = 0.16
    this.fanHead.add(guard)

    // 3 片扇葉
    const bladeMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.4 })
    const bladeGeo = new THREE.BoxGeometry(0.14, 0.34, 0.03)
    for (let i = 0; i < 3; i++) {
      const blade = new THREE.Mesh(bladeGeo, bladeMat)
      const angle = (i * Math.PI * 2) / 3
      blade.position.set(Math.sin(angle) * 0.17, Math.cos(angle) * 0.17, 0)
      blade.rotation.z = -angle
      this.fanBlades.add(blade)
    }
    this.fanBlades.position.z = 0.18
    this.fanHead.add(this.fanBlades)

    this.fanLedMat = new THREE.MeshBasicMaterial({ color: 0x334155 })
    const fanLed = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), this.fanLedMat)
    fanLed.position.set(0, 0.22, 0.05)
    this.fanHead.add(fanLed)

    fanGroup.add(this.fanHead)
    this.group.add(fanGroup)

    // 2. 冷氣（北牆高處）
    const acGroup = new THREE.Group()
    acGroup.position.set(DEVICE_LAYOUT.ac.x, DEVICE_LAYOUT.ac.y, DEVICE_LAYOUT.ac.z)
    const acBody = new THREE.Mesh(
      new THREE.BoxGeometry(3.2, 0.85, 0.65),
      new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.5 }),
    )
    acBody.castShadow = true
    acGroup.add(acBody)

    this.acFlap = new THREE.Mesh(
      new THREE.BoxGeometry(2.8, 0.12, 0.25),
      new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.5 }),
    )
    this.acFlap.position.set(0, -0.35, 0.3)
    acGroup.add(this.acFlap)

    this.acLedMat = new THREE.MeshBasicMaterial({ color: 0x334155 })
    const acLed = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.08, 0.05), this.acLedMat)
    acLed.position.set(1.25, -0.15, 0.34)
    acGroup.add(acLed)
    this.group.add(acGroup)

    // 3. 電腦主機（書桌右側）
    const pcGroup = new THREE.Group()
    pcGroup.position.set(DEVICE_LAYOUT.pc.x, 0, DEVICE_LAYOUT.pc.z)
    const pcCase = new THREE.Mesh(
      new THREE.BoxGeometry(0.65, 1.35, 0.85),
      new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.6 }),
    )
    pcCase.position.y = 0.675
    pcCase.castShadow = true
    pcCase.receiveShadow = true
    pcGroup.add(pcCase)

    this.pcGlowMat = new THREE.MeshBasicMaterial({ color: 0x475569 })
    const pcStrip = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.95, 0.04), this.pcGlowMat)
    pcStrip.position.set(0, 0.72, 0.44)
    pcGroup.add(pcStrip)

    this.pcHeatPlume = new THREE.Mesh(
      new THREE.CylinderGeometry(0.95, 0.45, 7.5, 12, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xf97316,
        transparent: true,
        opacity: 0.13,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    )
    this.pcHeatPlume.position.y = 5.1
    this.pcHeatPlume.visible = false
    pcGroup.add(this.pcHeatPlume)
    this.group.add(pcGroup)

    // 4. 窗戶（西牆 x = 0）
    const w = DEVICE_LAYOUT.window
    const winHeight = w.yMax - w.yMin
    const winWidth = w.zMax - w.zMin
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.6 })

    const winGroup = new THREE.Group()
    winGroup.position.set(0.06, (w.yMin + w.yMax) / 2, (w.zMin + w.zMax) / 2)

    // 窗框上下左右四條
    const topBar = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, winWidth + 0.2), frameMat)
    topBar.position.y = winHeight / 2
    const botBar = topBar.clone()
    botBar.position.y = -winHeight / 2
    winGroup.add(topBar, botBar)

    this.windowSashPivot.position.set(0, winHeight / 2, 0)
    const glass = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, winHeight - 0.15, winWidth - 0.15),
      new THREE.MeshStandardMaterial({
        color: 0x7dd3fc,
        transparent: true,
        opacity: 0.45,
        roughness: 0.2,
      }),
    )
    glass.position.y = -(winHeight - 0.15) / 2
    this.windowSashPivot.add(glass)
    winGroup.add(this.windowSashPivot)
    this.group.add(winGroup)

    // 5. 門（南牆 z = 16）
    const d = DEVICE_LAYOUT.door
    const doorWidth = d.xMax - d.xMin
    const doorHeight = d.yMax - d.yMin
    const doorFrameGroup = new THREE.Group()
    doorFrameGroup.position.set(d.xMin, 0, d.z - 0.08)

    this.doorLeafPivot.position.set(0, 0, 0)
    const doorLeaf = new THREE.Mesh(
      new THREE.BoxGeometry(doorWidth, doorHeight, 0.14),
      new THREE.MeshStandardMaterial({ color: 0x92400e, roughness: 0.75 }),
    )
    doorLeaf.position.set(doorWidth / 2, doorHeight / 2, 0)
    doorLeaf.castShadow = true
    this.doorLeafPivot.add(doorLeaf)

    const knob = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.3 }),
    )
    knob.position.set(doorWidth - 0.25, 1.5, -0.1)
    this.doorLeafPivot.add(knob)

    doorFrameGroup.add(this.doorLeafPivot)
    this.group.add(doorFrameGroup)
  }

  update(state: DeviceState, rawDt: number): void {
    const dt = Math.min(Math.max(rawDt, 0), 0.05)

    // 電風扇朝向與扇葉旋轉
    this.fanHead.rotation.y = state.fanYaw
    this.fanLedMat.color.setHex(state.fanOn ? 0x38bdf8 : 0x334155)
    if (state.fanOn) {
      this.fanBlades.rotation.z -= dt * 18
    }

    // 冷氣指示燈與導風板
    this.acLedMat.color.setHex(state.acOn ? 0x22d3ee : 0x334155)
    this.acFlap.rotation.x = state.acOn ? 0.55 : 0

    // 電腦主機發熱指示與熱氣柱
    this.pcGlowMat.color.setHex(state.pcHot ? 0xf97316 : 0x475569)
    this.pcHeatPlume.visible = state.pcHot

    // 窗戶平滑開關
    const targetWinAngle = state.windowOpen ? -0.65 : 0
    this.windowAngle += (targetWinAngle - this.windowAngle) * Math.min(1, dt * 8)
    this.windowSashPivot.rotation.z = this.windowAngle

    // 門平滑開關（往房間內側轉開方便觀察）
    const targetDoorAngle = state.doorOpen ? -1.25 : 0
    this.doorAngle += (targetDoorAngle - this.doorAngle) * Math.min(1, dt * 8)
    this.doorLeafPivot.rotation.y = this.doorAngle
  }

  dispose(): void {
    disposeObject3D(this.group)
  }
}
