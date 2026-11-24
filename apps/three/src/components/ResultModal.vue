<script setup lang="ts">
import type { GameLoopSnapshot } from '@toot/sim-core'

defineProps<{
  game: GameLoopSnapshot
}>()

const emit = defineEmits<{
  restart: []
}>()
</script>

<template>
  <div
    v-if="game.phase === 'won' || game.phase === 'lost'"
    class="absolute inset-0 z-30 flex items-center justify-center bg-slate-950/65 backdrop-blur-sm"
  >
    <div
      class="w-88 rounded-2xl border p-6 text-center shadow-2xl"
      :class="
        game.phase === 'won'
          ? 'border-emerald-400/50 bg-slate-900/95'
          : 'border-rose-500/50 bg-slate-900/95'
      "
    >
      <template v-if="game.phase === 'won'">
        <p class="text-3xl">🎉</p>
        <h2 class="mt-1 text-xl font-bold text-emerald-300">完美偷放過關！</h2>
        <div class="mt-3 flex justify-center gap-1 text-2xl">
          <span v-for="n in 3" :key="n" :class="n <= game.stars ? 'opacity-100' : 'opacity-20'">
            ⭐
          </span>
        </div>
        <p class="mt-2 font-mono text-3xl font-extrabold text-amber-300">{{ game.score }} 分</p>
      </template>

      <template v-else>
        <p class="text-3xl">💢</p>
        <h2 class="mt-1 text-xl font-bold text-rose-400">被抓到了！</h2>
        <p class="mt-1 text-xs text-slate-400">人類懷疑值突破 70%（之後會補上貓被踢出門動畫）</p>
      </template>

      <div class="mt-5 grid grid-cols-3 gap-2 rounded-xl bg-slate-950/70 p-3 text-xs">
        <div>
          <p class="text-slate-400">用時</p>
          <p class="mt-0.5 font-mono text-sm font-bold text-white">
            {{ game.elapsedSec.toFixed(1) }}s
          </p>
        </div>
        <div>
          <p class="text-slate-400">放屁次數</p>
          <p class="mt-0.5 font-mono text-sm font-bold text-sky-300">{{ game.fartPresses }} 次</p>
        </div>
        <div>
          <p class="text-slate-400">最高懷疑</p>
          <p class="mt-0.5 font-mono text-sm font-bold text-amber-300">
            {{ Math.round(game.maxSuspicion) }}%
          </p>
        </div>
      </div>

      <button
        type="button"
        class="mt-5 w-full cursor-pointer rounded-xl px-4 py-2.5 text-sm font-bold text-white transition active:scale-98"
        :class="
          game.phase === 'won'
            ? 'bg-emerald-600 hover:bg-emerald-500'
            : 'bg-rose-600 hover:bg-rose-500'
        "
        @click="emit('restart')"
      >
        {{ game.phase === 'won' ? '再玩一次' : '重新挑戰' }}
      </button>
    </div>
  </div>
</template>
