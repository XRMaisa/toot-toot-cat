<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { GRID, LEVEL_01, type CatState } from '@toot/sim-core'
import TouchControls from './components/TouchControls.vue'
import { ThreeStage, type HoverCellInfo, type StageStats } from './engine/ThreeStage'

const container = ref<HTMLDivElement>()
const hoverCell = ref<HoverCellInfo | null>(null)
const stats = ref<StageStats>({ entityCount: 0, drawCalls: 0, triangles: 0 })
const catState = ref<CatState | null>(null)
const showGrid = ref(true)
const showTouchControls = ref(true)

let stage: ThreeStage | undefined

function toggleGrid(): void {
  showGrid.value = !showGrid.value
  stage?.setGridVisible(showGrid.value)
}

onMounted(() => {
  if (!container.value) return
  stage = new ThreeStage(container.value, {
    onHoverCell: (info) => {
      hoverCell.value = info
    },
    onStats: (s) => {
      stats.value = s
    },
    onCatState: (c) => {
      catState.value = c
    },
  })
})

onBeforeUnmount(() => stage?.dispose())
</script>

<template>
  <div class="relative h-full w-full select-none overflow-hidden bg-slate-900">
    <div ref="container" class="absolute inset-0" />

    <!-- 左上角：關卡、貓咪狀態與效能除錯資訊 -->
    <div
      class="pointer-events-none absolute left-4 top-4 space-y-1 rounded-xl bg-slate-950/70 px-4 py-3 text-xs text-slate-200 backdrop-blur"
    >
      <p class="text-sm font-bold text-white">🐱💨 Toot Toot Cat · M2 貓咪操作</p>
      <p class="text-slate-300">
        關卡：{{ LEVEL_01.name }} · 空間 {{ GRID.NX }} × {{ GRID.NY }} × {{ GRID.NZ }}
      </p>
      <p class="text-slate-400">
        物件 {{ stats.entityCount }} · Draw Calls {{ stats.drawCalls }} · Triangles
        {{ stats.triangles }}
      </p>
      <div v-if="catState" class="border-t border-slate-700/80 pt-1.5 text-slate-300">
        貓咪格子：
        <span class="font-mono text-amber-300">
          ({{ catState.logicalCell.x }}, {{ catState.logicalCell.y }}, {{ catState.logicalCell.z }})
        </span>
        ·
        <span :class="catState.grounded ? 'text-emerald-300' : 'text-sky-300'">
          {{ catState.grounded ? '著地' : '跳躍中' }}
        </span>
        <span v-if="catState.isFarting" class="ml-1.5 font-bold text-lime-300">💨 放屁中</span>
      </div>
      <div class="border-t border-slate-700/80 pt-1.5 text-slate-300">
        <template v-if="hoverCell">
          指到地板
          <span class="font-mono text-sky-300">({{ hoverCell.x }}, {{ hoverCell.z }})</span>：
          <span v-if="hoverCell.occupants.length > 0" class="text-amber-300">
            {{ hoverCell.occupants.map((o) => `${o.label}#${o.id}`).join('、') }}
          </span>
          <span v-else class="text-slate-400">空</span>
        </template>
        <template v-else>
          <span class="text-slate-400">移動滑鼠到地板上查看格子座標</span>
        </template>
      </div>
    </div>

    <!-- 右上角：除錯開關與操作提示 -->
    <div class="absolute right-4 top-4 flex flex-col items-end gap-2 text-xs text-slate-200">
      <div class="flex gap-2">
        <button
          type="button"
          class="cursor-pointer rounded-lg border border-slate-600/80 bg-slate-950/75 px-3 py-1.5 font-medium text-white backdrop-blur transition hover:bg-slate-800"
          @click="toggleGrid"
        >
          {{ showGrid ? '隱藏格線' : '顯示格線' }}
        </button>
        <button
          type="button"
          class="cursor-pointer rounded-lg border border-slate-600/80 bg-slate-950/75 px-3 py-1.5 font-medium text-white backdrop-blur transition hover:bg-slate-800"
          @click="showTouchControls = !showTouchControls"
        >
          {{ showTouchControls ? '隱藏搖桿' : '顯示搖桿' }}
        </button>
      </div>
      <div class="pointer-events-none rounded-lg bg-slate-950/60 px-3 py-1.5 text-slate-300">
        方向鍵 / WASD 移動 · 左鍵跳躍（2 格） · 空白鍵放屁 · 右鍵轉視角
      </div>
    </div>

    <!-- 手機／測試用虛擬搖桿與按鈕 -->
    <TouchControls
      v-if="showTouchControls"
      @move="(r, f) => stage?.setVirtualMove(r, f)"
      @jump="stage?.triggerJump()"
      @fart="(held) => stage?.setVirtualFart(held)"
    />
  </div>
</template>
