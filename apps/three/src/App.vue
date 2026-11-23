<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { GRID, LEVEL_01 } from '@toot/sim-core'
import { ThreeStage, type HoverCellInfo, type StageStats } from './engine/ThreeStage'

const container = ref<HTMLDivElement>()
const hoverCell = ref<HoverCellInfo | null>(null)
const stats = ref<StageStats>({ entityCount: 0, drawCalls: 0, triangles: 0 })
const showGrid = ref(true)

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
  })
})

onBeforeUnmount(() => stage?.dispose())
</script>

<template>
  <div class="relative h-full w-full select-none bg-slate-900">
    <div ref="container" class="absolute inset-0" />

    <!-- 左上角：關卡與效能除錯資訊 -->
    <div
      class="pointer-events-none absolute left-4 top-4 space-y-1 rounded-xl bg-slate-950/70 px-4 py-3 text-xs text-slate-200 backdrop-blur"
    >
      <p class="text-sm font-bold text-white">🐱💨 Toot Toot Cat · M1 灰盒房間</p>
      <p class="text-slate-300">
        關卡：{{ LEVEL_01.name }} · 空間 {{ GRID.NX }} × {{ GRID.NY }} × {{ GRID.NZ }}
      </p>
      <p class="text-slate-400">
        物件 {{ stats.entityCount }} · Draw Calls {{ stats.drawCalls }} · Triangles
        {{ stats.triangles }}
      </p>
      <div class="border-t border-slate-700/80 pt-1.5 text-slate-300">
        <template v-if="hoverCell">
          格子 <span class="font-mono text-sky-300">({{ hoverCell.x }}, {{ hoverCell.z }})</span>：
          <span v-if="hoverCell.occupants.length > 0" class="text-amber-300">
            {{ hoverCell.occupants.map((o) => `${o.label}#${o.id}`).join('、') }}
          </span>
          <span v-else class="text-slate-400">空</span>
        </template>
        <template v-else>
          <span class="text-slate-400">移動滑鼠到地板上查看格子座標與佔用</span>
        </template>
      </div>
    </div>

    <!-- 右上角：除錯開關與操作提示 -->
    <div
      class="absolute right-4 top-4 flex flex-col items-end gap-2 text-xs text-slate-200"
    >
      <button
        type="button"
        class="cursor-pointer rounded-lg border border-slate-600/80 bg-slate-950/75 px-3 py-1.5 font-medium text-white backdrop-blur transition hover:bg-slate-800"
        @click="toggleGrid"
      >
        {{ showGrid ? '隱藏格線' : '顯示格線' }}
      </button>
      <div class="pointer-events-none rounded-lg bg-slate-950/60 px-3 py-1.5 text-slate-300">
        右鍵拖曳旋轉視角 · 中鍵平移 · 滾輪縮放
      </div>
    </div>
  </div>
</template>
