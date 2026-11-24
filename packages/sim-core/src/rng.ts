export type RngFn = () => number

/**
 * Mulberry32 確定性偽亂數產生器。
 * - 傳入整數 seed 時，每次執行都會產生 100% 相同的亂數序列（適合單元測試與 Three.js / Babylon.js 效能對比）
 * - 未傳 seed 時回退使用 Math.random
 */
export function createRng(seed?: number): RngFn {
  if (seed === undefined) return Math.random
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
