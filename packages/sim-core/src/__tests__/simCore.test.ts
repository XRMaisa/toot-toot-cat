import { describe, expect, it } from 'vitest'
import {
  CatController,
  DeviceSystem,
  GRID,
  GameLoop,
  LEVEL_01,
  OccupancyGrid,
  SimulationWorld,
  StinkSystem,
  createRng,
  findFloorPath,
  loadLevel,
  parseLevelJson,
  serializeLevelJson,
} from '../index'

describe('OccupancyGrid', () => {
  it('enforces single-entity-per-cell and boundary checks', () => {
    const grid = new OccupancyGrid()
    const bed = grid.place('bed', { x: 1, y: 0, z: 1 })
    expect(bed).not.toBeNull()

    // 床佔 (1..3, 0, 1..3)，在 (2, 0, 2) 放椅子應被拒絕
    expect(grid.place('chair', { x: 2, y: 0, z: 2 })).toBeNull()
    // 超出房間邊界應被拒絕
    expect(grid.place('bed', { x: GRID.NX - 1, y: 0, z: 1 })).toBeNull()
    // 家具阻擋臭氣、貓與人不阻擋臭氣
    expect(grid.isSolidForSmell(2, 0, 2)).toBe(true)
    const cat = grid.place('cat', { x: 8, y: 0, z: 8 })
    expect(cat).not.toBeNull()
    expect(grid.isSolidForSmell(8, 0, 8)).toBe(false)
  })
})

describe('CatController', () => {
  it('jumps 2 cells high onto surfaces but cannot jump 3 cells from floor', () => {
    const loaded = loadLevel(LEVEL_01)
    const cat = new CatController(loaded.grid, loaded.cat)

    let peakY = 0
    cat.step({ moveX: 0, moveZ: 0, jumpJustPressed: true, fartHeld: false }, 0.016)
    for (let i = 0; i < 80; i++) {
      const state = cat.step({ moveX: 0, moveZ: 0, jumpJustPressed: false, fartHeld: false }, 0.016)
      if (state.position.y > peakY) peakY = state.position.y
    }

    expect(peakY).toBeGreaterThan(2.05)
    expect(peakY).toBeLessThan(2.95)
  })

  it('prevents movement and farting while locked', () => {
    const loaded = loadLevel(LEVEL_01)
    const cat = new CatController(loaded.grid, loaded.cat)
    const before = cat.getState().position
    const after = cat.step(
      { moveX: 1, moveZ: 0, jumpJustPressed: true, fartHeld: true, locked: true },
      0.05,
    )
    expect(after.position).toEqual(before)
    expect(after.isFarting).toBe(false)
  })
})

describe('findFloorPath (A*)', () => {
  it('routes around furniture cleanly', () => {
    const loaded = loadLevel(LEVEL_01)
    const path = findFloorPath(
      loaded.grid,
      { x: 0, z: 2 },
      { x: 5, z: 2 },
      loaded.human.id,
      loaded.cat.id,
    )
    expect(path).not.toBeNull()
    expect(path!.length).toBeGreaterThan(5) // 必須繞過佔據 x=1..3, z=1..3 的床
    for (const step of path!) {
      const ent = loaded.grid.getEntityAt(step.x, 0, step.z)
      expect(ent?.kind).not.toBe('bed')
    }
  })
})

describe('StinkSystem + DeviceSystem + Seeded RNG', () => {
  it('produces identical particle trajectories when given the same seed', () => {
    const runWithSeed = (seed: number) => {
      const loaded = loadLevel(LEVEL_01)
      const stink = new StinkSystem(createRng(seed))
      const devices = new DeviceSystem()
      devices.toggle('fan')
      devices.toggle('pc')

      let snap = stink.getSnapshot()
      for (let i = 0; i < 30; i++) {
        devices.step(0.05)
        snap = stink.step(
          loaded.grid,
          { active: true, x: 8, y: 0.4, z: 8, dirX: 0, dirZ: -1 },
          { x: 0, y: 9, z: 0 },
          0.05,
          devices,
        )
      }
      return {
        snap,
        firstPos: [stink.posX[0], stink.posY[0], stink.posZ[0]],
      }
    }

    expect(runWithSeed(42)).toEqual(runWithSeed(42))
  })

  it('exhausts particles through an open window', () => {
    const loaded = loadLevel(LEVEL_01)
    const stink = new StinkSystem(createRng(7))
    const devices = new DeviceSystem()
    devices.toggle('window')

    let snap = stink.getSnapshot()
    for (let i = 0; i < 40; i++) {
      snap = stink.step(
        loaded.grid,
        { active: true, x: 0.5, y: 3.5, z: 8.0, dirX: -1, dirZ: 0 },
        { x: 15, y: 2, z: 15 },
        0.05,
        devices,
      )
    }
    expect(snap.totalExhausted).toBeGreaterThan(0)
  })

  it('bursts an initial cloud covering at least a 2x2 grid footprint on first fart', () => {
    const loaded = loadLevel(LEVEL_01)
    const stink = new StinkSystem(createRng(99))
    const snap = stink.step(
      loaded.grid,
      { active: true, x: 8.5, y: 0.4, z: 8.5, dirX: 0, dirZ: -1 },
      { x: 0, y: 9, z: 0 },
      0.05,
    )

    expect(snap.activeParticles).toBeGreaterThanOrEqual(30)
    const occupiedXZ = new Set<string>()
    for (let i = 0; i < stink.capacity; i++) {
      if (stink.alive[i] === 0) continue
      occupiedXZ.add(`${Math.floor(stink.posX[i] ?? 0)},${Math.floor(stink.posZ[i] ?? 0)}`)
    }
    expect(occupiedXZ.size).toBeGreaterThanOrEqual(4)
  })
})

describe('GameLoop (Endless Mode)', () => {
  it('builds belly pressure when holding back and triggers forced mega-burst at 100%', () => {
    const loop = new GameLoop()
    let snap = loop.getSnapshot()

    // 忍住不放屁約 12 秒，肚子脹氣應達到 100% 並觸發強制大爆屁
    for (let i = 0; i < 240; i++) {
      snap = loop.step(false, 10, 0, 0.05)
      if (snap.isForcedBurst) break
    }
    expect(snap.isForcedBurst).toBe(true)
    expect(snap.forcedBurstRemaining).toBeGreaterThan(0)
  })

  it('drains belly pressure and scores combo points while voluntarily farting', () => {
    const loop = new GameLoop()
    const before = loop.getSnapshot().bellyPressure
    let snap = loop.getSnapshot()
    for (let i = 0; i < 20; i++) {
      snap = loop.step(true, 10, 2, 0.05)
    }
    expect(snap.bellyPressure).toBeLessThan(before)
    expect(snap.comboMultiplier).toBeGreaterThan(1)
    expect(snap.score).toBeGreaterThan(50)
    expect(snap.totalExhausted).toBe(40)
  })

  it('escalates difficulty level and potency over time and ends when suspicion reaches 70', () => {
    const loop = new GameLoop()
    let snap = loop.getSnapshot()
    // 撐過 25 秒（500 * 0.05s）應升至 Lv.2 且濃度 > 1.0x
    for (let i = 0; i < 500; i++) {
      snap = loop.step(i % 4 === 0, 10, 0, 0.05)
    }
    expect(snap.level).toBeGreaterThanOrEqual(2)
    expect(snap.potencyMultiplier).toBeGreaterThan(1)

    const lost = loop.step(false, 70, 0, 0.05)
    expect(lost.phase).toBe('lost')
    expect(lost.score).toBeGreaterThan(0)
  })
})

describe('SimulationWorld & Level JSON', () => {
  it('orchestrates all 5 systems deterministically with a seed', () => {
    const w1 = new SimulationWorld(LEVEL_01, { seed: 123 })
    const w2 = new SimulationWorld(LEVEL_01, { seed: 123 })

    let f1 = w1.getFrame()
    let f2 = w2.getFrame()
    for (let i = 0; i < 40; i++) {
      const input = { moveX: 0.5, moveZ: -0.5, jumpJustPressed: i === 5, fartHeld: i < 20 }
      f1 = w1.step(input, 0.05)
      f2 = w2.step(input, 0.05)
    }
    expect(f1).toEqual(f2)
  })

  it('round-trips level JSON via serializeLevelJson / parseLevelJson', () => {
    const json = serializeLevelJson(LEVEL_01)
    expect(parseLevelJson(json)).toEqual(LEVEL_01)
  })
})
