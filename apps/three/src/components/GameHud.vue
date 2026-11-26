<script setup lang="ts">
import { computed } from 'vue'
import type { GameLoopSnapshot } from '@toot/sim-core'

const props = defineProps<{
  game: GameLoopSnapshot
  bestScore: number
}>()

const formattedTime = computed(() => {
  const sec = props.game.elapsedSec
  const mins = Math.floor(sec / 60)
  const rem = sec % 60
  return `${String(mins).padStart(2, '0')}:${rem.toFixed(1).padStart(4, '0')}`
})

const bellyPct = computed(() => Math.round(props.game.bellyPressure))

const bellyBarClass = computed(() => {
  if (props.game.isForcedBurst || props.game.bellyPressure >= 80) {
    return 'bg-gradient-to-r from-orange-500 to-rose-500'
  }
  if (props.game.bellyPressure >= 55) {
    return 'bg-gradient-to-r from-amber-400 to-orange-400'
  }
  return 'bg-gradient-to-r from-lime-400 to-emerald-400'
})
</script>

<template>
  <div class="pointer-events-none absolute left-1/2 top-4 flex -translate-x-1/2 flex-col items-center gap-2">
    <!-- 主無盡高分面板 -->
    <div
      class="flex items-center gap-3 rounded-2xl border border-slate-700/80 bg-slate-950/88 px-4 py-2 text-xs text-slate-200 shadow-xl md:gap-5 md:px-5 md:py-2.5 md:backdrop-blur"
    >
      <!-- 難度等級與時間 -->
      <div class="flex flex-col items-center">
        <span class="text-[10px] font-bold text-lime-300">
          Lv.{{ game.level }} · 濃度 {{ game.potencyMultiplier.toFixed(2) }}x
        </span>
        <span class="font-mono text-sm font-bold text-white">{{ formattedTime }}</span>
      </div>

      <div class="h-7 w-px bg-slate-700/80" />

      <!-- 肚子脹氣條（滿 100% 強制大爆屁） -->
      <div class="flex w-32 flex-col gap-1 md:w-40">
        <div class="flex items-center justify-between text-[10px]">
          <span
            class="font-medium"
            :class="bellyPct >= 80 || game.isForcedBurst ? 'text-rose-300 font-bold' : 'text-slate-300'"
          >
            {{ game.isForcedBurst ? '💥 爆屁中' : '🫄 肚子脹氣' }}
          </span>
          <span class="font-mono font-bold text-white">{{ bellyPct }}%</span>
        </div>
        <div class="h-2.5 w-full overflow-hidden rounded-full bg-slate-800">
          <div
            class="h-full rounded-full transition-all duration-100"
            :class="bellyBarClass"
            :style="{ width: `${Math.min(100, bellyPct)}%` }"
          />
        </div>
      </div>

      <div class="h-7 w-px bg-slate-700/80" />

      <!-- 目前分數與連放 Combo -->
      <div class="flex flex-col items-center">
        <div class="flex items-center gap-1 text-[10px] text-slate-400">
          <span>分數</span>
          <span
            v-if="game.comboMultiplier > 1.05"
            class="rounded bg-amber-500/25 px-1 font-mono font-bold text-amber-300"
          >
            x{{ game.comboMultiplier.toFixed(1) }}
          </span>
        </div>
        <span class="font-mono text-base font-extrabold text-amber-300">{{ game.score }}</span>
      </div>

      <div class="hidden h-7 w-px bg-slate-700/80 md:block" />

      <!-- 歷史最高分 -->
      <div class="hidden flex-col items-center md:flex">
        <span class="text-[10px] text-slate-400">🏆 最高分</span>
        <span class="font-mono text-sm font-bold text-emerald-300">
          {{ Math.max(bestScore, game.score) }}
        </span>
      </div>
    </div>

    <!-- 強制大爆屁警告橫幅 -->
    <div
      v-if="game.isForcedBurst"
      class="animate-pulse rounded-full border border-rose-400/80 bg-rose-950/90 px-4 py-1 text-xs font-bold text-rose-200 shadow-lg"
    >
      💥 忍太久肚子脹爆！強制大爆屁中（{{ game.forcedBurstRemaining.toFixed(1) }}s）
    </div>
    <div
      v-else-if="bellyPct >= 80"
      class="rounded-full border border-amber-400/70 bg-amber-950/85 px-3.5 py-0.5 text-[11px] font-bold text-amber-200"
    >
      ⚠️ 快忍不住了！趕快找安全角落放屁洩壓！
    </div>
  </div>
</template>
