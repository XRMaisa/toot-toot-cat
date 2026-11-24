<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  GRID,
  HUMAN_ACTIVITY_LABELS,
  LEVEL_01,
  SUSPICION_THRESHOLD,
  type CatState,
  type HumanState,
  type StinkSnapshot,
} from '@toot/sim-core'
import TouchControls from './components/TouchControls.vue'
import { ThreeStage, type HoverCellInfo, type StageStats } from './engine/ThreeStage'

const container = ref<HTMLDivElement>()
const hoverCell = ref<HoverCellInfo | null>(null)
const stats = ref<StageStats>({ entityCount: 0, drawCalls: 0, triangles: 0 })
const catState = ref<CatState | null>(null)
const humanState = ref<HumanState | null>(null)
const stinkState = ref<StinkSnapshot>({
  activeParticles: 0,
  suspicion: 0,
  alertLevel: 'calm',
  totalInhaled: 0,
  maxCellCount: 0,
})
const showGrid = ref(true)
const showHeatmap = ref(false)
const showTouchControls = ref(true)

let stage: ThreeStage | undefined

const alertBadge = computed(() => {
  switch (stinkState.value.alertLevel) {
    case 'caught':
      return { text: '💢 被抓到了！', cls: 'text-rose-400 font-bold' }
    case 'suspicious':
      return { text: '❓ 開始懷疑', cls: 'text-amber-300 font-bold' }
    default:
      return { text: '😌 沒感覺', cls: 'text-emerald-300' }
  }
})

const suspicionBarColor = computed(() => {
  switch (stinkState.value.alertLevel) {
    case 'caught':
      return 'bg-rose-500'
    case 'suspicious':
      return 'bg-amber-400'
    default:
      return 'bg-emerald-400'
  }
})

const humanActivityText = computed(() => {
  const h = humanState.value
  if (!h) return '—'
  const label = HUMAN_ACTIVITY_LABELS[h.activity]
  if (h.activity === 'petCat') return label
  return h.isMoving ? `前往：${label}` : `${label} (${Math.max(0, h.actionTimer).toFixed(1)}s)`
})

function toggleGrid(): void {
  showGrid.value = !showGrid.value
  stage?.setGridVisible(showGrid.value)
}

function toggleHeatmap(): void {
  showHeatmap.value = !showHeatmap.value
  stage?.setHeatmapVisible(showHeatmap.value)
}

function resetStink(): void {
  stage?.resetStink()
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
    onHumanState: (h) => {
      humanState.value = h
    },
    onStinkState: (st) => {
      stinkState.value = st
    },
  })
})

onBeforeUnmount(() => stage?.dispose())
</script>

<template>
  <div class="relative h-full w-full select-none overflow-hidden bg-slate-900">
    <div ref="container" class="absolute inset-0" />

    <!-- 左上角：關卡、懷疑值、人類 AI、貓咪與效能除錯資訊 -->
    <div
      class="pointer-events-none absolute left-4 top-4 w-76 space-y-2 rounded-xl bg-slate-950/75 px-4 py-3 text-xs text-slate-200 backdrop-blur"
    >
      <div>
        <p class="text-sm font-bold text-white">🐱💨 Toot Toot Cat · M4 人類 AI</p>
        <p class="text-slate-400">
          {{ LEVEL_01.name }} · {{ GRID.NX }}×{{ GRID.NY }}×{{ GRID.NZ }} · Draw Calls
          {{ stats.drawCalls }}
        </p>
      </div>

      <!-- 人類懷疑值條 -->
      <div class="space-y-1 border-t border-slate-700/80 pt-2">
        <div class="flex items-center justify-between">
          <span class="text-slate-300">人類懷疑值</span>
          <span :class="alertBadge.cls">
            {{ alertBadge.text }} ({{ Math.round(stinkState.suspicion) }}%)
          </span>
        </div>
        <div class="relative h-2.5 w-full overflow-hidden rounded-full bg-slate-800">
          <div
            class="h-full transition-all duration-100"
            :class="suspicionBarColor"
            :style="{ width: `${Math.min(100, stinkState.suspicion)}%` }"
          />
          <div
            class="absolute inset-y-0 w-0.5 bg-amber-200/70"
            :style="{ left: `${SUSPICION_THRESHOLD.suspicious}%` }"
          />
          <div
            class="absolute inset-y-0 w-0.5 bg-rose-200/80"
            :style="{ left: `${SUSPICION_THRESHOLD.caught}%` }"
          />
        </div>
        <p class="text-[11px] text-slate-400">
          粒子 {{ stinkState.activeParticles }} · 頭部吸入 {{ stinkState.totalInhaled }} · 單格峰值
          {{ stinkState.maxCellCount }}
        </p>
      </div>

      <!-- 人類 AI 狀態 -->
      <div v-if="humanState" class="border-t border-slate-700/80 pt-1.5 text-slate-300">
        <p>
          人類行動：<span class="font-medium text-sky-300">{{ humanActivityText }}</span>
        </p>
        <p class="text-[11px] text-slate-400">
          頭部格子
          <span class="font-mono text-slate-300">
            ({{ humanState.headCell.x }}, {{ humanState.headCell.y }}, {{ humanState.headCell.z }})
          </span>
        </p>
      </div>

      <!-- 貓咪狀態 -->
      <div v-if="catState" class="border-t border-slate-700/80 pt-1.5 text-slate-300">
        貓咪格子
        <span class="font-mono text-amber-300">
          ({{ catState.logicalCell.x }}, {{ catState.logicalCell.y }}, {{ catState.logicalCell.z }})
        </span>
        ·
        <span v-if="humanState?.activity === 'petCat'" class="font-bold text-pink-300">
          被摸摸中（鎖定）
        </span>
        <span v-else :class="catState.grounded ? 'text-emerald-300' : 'text-sky-300'">
          {{ catState.grounded ? '著地' : '跳躍中' }}
        </span>
        <span v-if="catState.isFarting" class="ml-1 font-bold text-lime-300">💨</span>
      </div>

      <!-- 地板游標資訊 -->
      <div class="border-t border-slate-700/80 pt-1.5 text-slate-300">
        <template v-if="hoverCell">
          地板
          <span class="font-mono text-sky-300">({{ hoverCell.x }}, {{ hoverCell.z }})</span>：
          <span v-if="hoverCell.occupants.length > 0" class="text-amber-300">
            {{ hoverCell.occupants.map((o) => `${o.label}#${o.id}`).join('、') }}
          </span>
          <span v-else class="text-slate-400">空</span>
        </template>
        <template v-else>
          <span class="text-slate-400">移到地板查看格子座標</span>
        </template>
      </div>
    </div>

    <!-- 右上角：除錯開關與操作提示 -->
    <div class="absolute right-4 top-4 flex flex-col items-end gap-2 text-xs text-slate-200">
      <div class="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          class="cursor-pointer rounded-lg border px-3 py-1.5 font-medium text-white backdrop-blur transition"
          :class="
            showHeatmap
              ? 'border-lime-400/80 bg-lime-600/70 hover:bg-lime-500/80'
              : 'border-slate-600/80 bg-slate-950/75 hover:bg-slate-800'
          "
          @click="toggleHeatmap"
        >
          {{ showHeatmap ? '隱藏 3D 熱力圖' : '顯示 3D 熱力圖' }}
        </button>
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
        <button
          type="button"
          class="cursor-pointer rounded-lg border border-rose-500/60 bg-rose-950/70 px-3 py-1.5 font-medium text-rose-100 backdrop-blur transition hover:bg-rose-900/80"
          @click="resetStink"
        >
          重置臭氣
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
