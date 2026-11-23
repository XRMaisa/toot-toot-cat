/**
 * @toot/sim-core
 * 純 TypeScript、零渲染引擎依賴的模擬核心。
 * Three.js 與 Babylon.js 兩個版本共用同一份模擬與空間佔用資料。
 */

export {
  CELL_COUNT,
  GRID,
  ROOM_SIZE,
  SIM_STEP_MS,
  SUSPICION_THRESHOLD,
  cellIndex,
  cellToWorldCenter,
  isInBounds,
  worldToCell,
  type GridCoord,
} from './constants'

export {
  ENTITY_SPECS,
  OccupancyGrid,
  boxFootprint,
  defaultFootprint,
  type ActorKind,
  type EntityKind,
  type EntitySpec,
  type FurnitureKind,
  type GridEntity,
} from './occupancy'

export {
  LEVEL_01,
  loadLevel,
  type LevelData,
  type LevelFurniturePlacement,
  type LoadedLevel,
} from './level'
