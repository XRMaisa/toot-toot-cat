<script setup lang="ts">
import type { DeviceId, DeviceState } from '@toot/sim-core'

defineProps<{
  devices: DeviceState
}>()

const emit = defineEmits<{
  toggle: [id: DeviceId]
}>()
</script>

<template>
  <div
    class="absolute right-4 top-24 z-10 w-48 space-y-1.5 rounded-xl border border-slate-700/80 bg-slate-950/88 p-2.5 text-xs text-slate-200 md:w-52 md:p-3 md:backdrop-blur"
    @pointerdown.stop
  >
    <p class="text-[11px] font-bold tracking-wide text-slate-300">⚡ 房間 IoT 設備控制</p>

    <div class="grid grid-cols-1 gap-1.5">
      <!-- 電風扇 -->
      <div class="flex gap-1">
        <button
          type="button"
          class="flex flex-1 cursor-pointer items-center justify-between rounded-lg border px-2.5 py-1.5 font-medium transition"
          :class="
            devices.fanOn
              ? 'border-sky-400/80 bg-sky-600/45 text-white'
              : 'border-slate-700/80 bg-slate-900/70 text-slate-300 hover:bg-slate-800'
          "
          @click="emit('toggle', 'fan')"
        >
          <span>🌀 電風扇</span>
          <span class="text-[10px]">{{ devices.fanOn ? 'ON' : 'OFF' }}</span>
        </button>
        <button
          type="button"
          title="切換擺頭"
          class="cursor-pointer rounded-lg border px-2 py-1.5 text-[10px] font-medium transition"
          :class="
            devices.fanOscillate
              ? 'border-sky-400/60 bg-sky-500/25 text-sky-200'
              : 'border-slate-700/80 bg-slate-900/70 text-slate-400 hover:bg-slate-800'
          "
          @click="emit('toggle', 'fanOscillate')"
        >
          擺頭
        </button>
      </div>

      <!-- 冷氣 -->
      <button
        type="button"
        class="flex cursor-pointer items-center justify-between rounded-lg border px-2.5 py-1.5 font-medium transition"
        :class="
          devices.acOn
            ? 'border-cyan-400/80 bg-cyan-600/45 text-white'
            : 'border-slate-700/80 bg-slate-900/70 text-slate-300 hover:bg-slate-800'
        "
        @click="emit('toggle', 'ac')"
      >
        <span>❄️ 冷氣（下沉風）</span>
        <span class="text-[10px]">{{ devices.acOn ? 'ON' : 'OFF' }}</span>
      </button>

      <!-- 電腦主機發熱 -->
      <button
        type="button"
        class="flex cursor-pointer items-center justify-between rounded-lg border px-2.5 py-1.5 font-medium transition"
        :class="
          devices.pcHot
            ? 'border-orange-400/80 bg-orange-600/45 text-white'
            : 'border-slate-700/80 bg-slate-900/70 text-slate-300 hover:bg-slate-800'
        "
        @click="emit('toggle', 'pc')"
      >
        <span>🔥 電腦高負載</span>
        <span class="text-[10px]">{{ devices.pcHot ? '發熱' : '待機' }}</span>
      </button>

      <!-- 窗戶與門（排氣口） -->
      <div class="grid grid-cols-2 gap-1.5">
        <button
          type="button"
          class="flex cursor-pointer items-center justify-between rounded-lg border px-2 py-1.5 font-medium transition"
          :class="
            devices.windowOpen
              ? 'border-emerald-400/80 bg-emerald-600/45 text-white'
              : 'border-slate-700/80 bg-slate-900/70 text-slate-300 hover:bg-slate-800'
          "
          @click="emit('toggle', 'window')"
        >
          <span>🪟 窗戶</span>
          <span class="text-[10px]">{{ devices.windowOpen ? '開' : '關' }}</span>
        </button>

        <button
          type="button"
          class="flex cursor-pointer items-center justify-between rounded-lg border px-2 py-1.5 font-medium transition"
          :class="
            devices.doorOpen
              ? 'border-emerald-400/80 bg-emerald-600/45 text-white'
              : 'border-slate-700/80 bg-slate-900/70 text-slate-300 hover:bg-slate-800'
          "
          @click="emit('toggle', 'door')"
        >
          <span>🚪 門</span>
          <span class="text-[10px]">{{ devices.doorOpen ? '開' : '關' }}</span>
        </button>
      </div>
    </div>
  </div>
</template>
