<script setup lang="ts">
import { computed } from 'vue'
import type { GameLoopSnapshot } from '@toot/sim-core'

const props = defineProps<{
  game: GameLoopSnapshot
}>()

const formattedTime = computed(() => {
  const sec = props.game.elapsedSec
  const mins = Math.floor(sec / 60)
  const rem = sec % 60
  return `${String(mins).padStart(2, '0')}:${rem.toFixed(1).padStart(4, '0')}`
})

const progressPct = computed(() => Math.round(props.game.fartProgress * 100))
</script>

<template>
  <div class="pointer-events-none absolute left-1/2 top-4 flex -translate-x-1/2 flex-col items-center gap-2">
    <!-- 主計時與計分條 -->
    <div
      class="flex items-center gap-5 rounded-2xl border border-slate-700/80 bg-slate-950/80 px-5 py-2.5 text-xs text-slate-200 shadow-xl backdrop-blur"
    >
      <!-- 計時 -->
      <div class="flex flex-col items-center">
        <span class="text-[10px] text-slate-400">時間</span>
        <span class="font-mono text-base font-bold text-white">{{ formattedTime }}</span>
      </div>

      <div class="h-7 w-px bg-slate-700/80" />

      <!-- 屁額度進度條 -->
      <div class="flex w-36 flex-col gap-1">
        <div class="flex items-center justify-between text-[10px]">
          <span class="text-slate-300">💨 屁額度</span>
          <span class="font-mono font-bold text-lime-300">{{ progressPct }}%</span>
        </div>
        <div class="h-2.5 w-full overflow-hidden rounded-full bg-slate-800">
          <div
            class="h-full rounded-full bg-gradient-to-r from-lime-400 to-emerald-400 transition-all duration-100"
            :style="{ width: `${progressPct}%` }"
          />
        </div>
      </div>

      <div class="h-7 w-px bg-slate-700/80" />

      <!-- 放屁次數 -->
      <div class="flex flex-col items-center">
        <span class="text-[10px] text-slate-400">次數 (標準 {{ game.parPresses }})</span>
        <span
          class="font-mono text-base font-bold"
          :class="game.fartPresses <= game.parPresses ? 'text-sky-300' : 'text-amber-300'"
        >
          {{ game.fartPresses }}
        </span>
      </div>

      <div class="h-7 w-px bg-slate-700/80" />

      <!-- 預估分數 -->
      <div class="flex flex-col items-center">
        <span class="text-[10px] text-slate-400">預估分數</span>
        <span class="font-mono text-base font-bold text-amber-300">{{ game.score }}</span>
      </div>
    </div>

    <!-- 放完屁後的 3 秒安全判定倒數 -->
    <div
      v-if="game.phase === 'safeCheck'"
      class="animate-pulse rounded-full border border-emerald-400/70 bg-emerald-950/85 px-4 py-1 text-xs font-bold text-emerald-200 shadow-lg backdrop-blur"
    >
      ⏳ 額度已放完！撐住別被聞到：{{ game.safeCountdownSec.toFixed(1) }}s
    </div>
  </div>
</template>
