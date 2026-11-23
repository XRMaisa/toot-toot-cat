# 🐱💨 Toot Toot Cat

Q 版貓咪放屁 × 工業數位孿生（Web3D / WebXR）小遊戲。
表層是可愛的貓咪房間小遊戲，底層對應 HVAC / DCIM 的氣體濃度、氣流與熱浮力模擬。

完整規格請見 [docs/spec.md](docs/spec.md)。

## 專案結構（npm workspaces monorepo）

```
apps/
  three/        Three.js + Vue 3 + Vite + Tailwind + TypeScript 版本
  babylon/      （規劃中）Babylon.js + TypeScript 版本，用於引擎比較
packages/
  sim-core/     與引擎無關的模擬核心（網格、擴散、風場、熱浮力），兩個版本共用
docs/
  spec.md       專案規格書
```

模擬邏輯集中在 `sim-core`，兩個引擎版本只負責渲染與互動，才能公平比較效能與除錯體驗。

## 開發

```bash
npm install
npm run dev        # 啟動 Three.js 版本
npm run build      # 建置所有 workspace
npm run typecheck
```

WebXR 開發可使用 Chrome 擴充套件 **Immersive Web Emulator** 模擬頭顯。
