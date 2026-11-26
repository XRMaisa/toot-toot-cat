<script setup lang="ts">
import type { GameLoopSnapshot } from '@toot/sim-core'

defineProps<{
  game: GameLoopSnapshot
  bestScore: number
  isNewBest: boolean
}>()

const emit = defineEmits<{
  restart: []
}>()
</script>

<template>
  <div
    v-if="game.phase === 'lost'"
    class="absolute inset-0 z-30 flex items-center justify-center bg-slate-950/75 p-4"
  >
    <div
      class="w-88 rounded-2xl border border-rose-500/50 bg-slate-900/95 p-6 text-center shadow-2xl"
    >
      <p class="text-3xl">💢</p>
      <h2 class="mt-1 text-xl font-bold text-rose-400">被抓到了！</h2>
      <p class="mt-1 text-xs text-slate-400">人類懷疑值突破 70%（無盡挑戰結算）</p>

      <div class="mt-4">
        <span
          v-if="isNewBest"
          class="inline-block rounded-full bg-amber-500/20 px-3 py-0.5 text-xs font-bold text-amber-300"
        >
          🏆 破紀錄 NEW BEST!
        </span>
        <p class="mt-1 font-mono text-4xl font-extrabold text-amber-300">{{ game.score }}</p>
        <p class="mt-1 text-xs text-slate-400">
          歷史最高分：<span class="font-mono font-bold text-emerald-300">{{ bestScore }}</span>
        </p>
      </div>

      <div class="mt-5 grid grid-cols-3 gap-2 rounded-xl bg-slate-950/70 p-3 text-xs">
        <div>
          <p class="text-slate-400">撐過時間</p>
          <p class="mt-0.5 font-mono text-sm font-bold text-white">
            {{ game.elapsedSec.toFixed(1) }}s
          </p>
        </div>
        <div>
          <p class="text-slate-400">達到等級</p>
          <p class="mt-0.5 font-mono text-sm font-bold text-lime-300">Lv.{{ game.level }}</p>
        </div>
        <div>
          <p class="text-slate-400">排氣顆數</p>
          <p class="mt-0.5 font-mono text-sm font-bold text-emerald-300">
            {{ game.totalExhausted }}
          </p>
        </div>
      </div>

      <button
        type="button"
        class="mt-5 w-full cursor-pointer rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-rose-500 active:scale-98"
        @click="emit('restart')"
      >
        再衝一次最高分
      </button>
    </div>
  </div>
</template>
