<script setup lang="ts">
import { ref } from 'vue'

const emit = defineEmits<{
  move: [right: number, forward: number]
  jump: []
  fart: [held: boolean]
}>()

const MAX_RADIUS = 44
const padEl = ref<HTMLDivElement>()
const knobX = ref(0)
const knobY = ref(0)
const fartActive = ref(false)
let activePointerId: number | null = null

function updateStick(e: PointerEvent): void {
  if (!padEl.value) return
  const rect = padEl.value.getBoundingClientRect()
  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2
  let dx = e.clientX - cx
  let dy = e.clientY - cy
  const dist = Math.hypot(dx, dy)
  if (dist > MAX_RADIUS) {
    dx = (dx / dist) * MAX_RADIUS
    dy = (dy / dist) * MAX_RADIUS
  }
  knobX.value = dx
  knobY.value = dy
  emit('move', dx / MAX_RADIUS, -dy / MAX_RADIUS)
}

function onStickDown(e: PointerEvent): void {
  if (activePointerId !== null) return
  activePointerId = e.pointerId
  padEl.value?.setPointerCapture(e.pointerId)
  updateStick(e)
}

function onStickMove(e: PointerEvent): void {
  if (e.pointerId !== activePointerId) return
  updateStick(e)
}

function onStickEnd(e: PointerEvent): void {
  if (e.pointerId !== activePointerId) return
  activePointerId = null
  knobX.value = 0
  knobY.value = 0
  emit('move', 0, 0)
}

function onJumpDown(): void {
  emit('jump')
}

function onFartDown(e: PointerEvent): void {
  ; (e.currentTarget as HTMLElement | null)?.setPointerCapture(e.pointerId)
  fartActive.value = true
  emit('fart', true)
}

function onFartUp(): void {
  if (!fartActive.value) return
  fartActive.value = false
  emit('fart', false)
}
</script>

<template>
  <!-- 左下角：虛擬搖桿 -->
  <div ref="padEl"
    class="absolute bottom-6 left-6 flex h-32 w-32 touch-none items-center justify-center rounded-full border-2 border-white/25 bg-slate-950/65"
    @pointerdown.stop="onStickDown" @pointermove.stop="onStickMove" @pointerup.stop="onStickEnd"
    @pointercancel.stop="onStickEnd">
    <div class="pointer-events-none h-12 w-12 rounded-full border border-white/50 bg-white/30 shadow-lg"
      :style="{ transform: `translate(${knobX}px, ${knobY}px)` }" />
  </div>

  <!-- 右下角：跳躍 & 放屁按鈕 -->
  <div class="absolute bottom-6 right-6 flex items-end gap-4">
    <button type="button"
      class="flex h-18 w-18 cursor-pointer touch-none flex-col items-center justify-center rounded-full border-2 border-sky-300/60 bg-sky-600/65 text-xs font-bold text-white active:scale-95 active:bg-sky-400/80"
      @pointerdown.stop="onJumpDown">
      <span class="text-lg leading-none">⬆️</span>
      <span>跳躍</span>
    </button>

    <button type="button"
      class="flex h-20 w-20 cursor-pointer touch-none flex-col items-center justify-center rounded-full border-2 text-xs font-bold text-white transition active:scale-95"
      :class="fartActive
          ? 'border-lime-300 bg-lime-500/85'
          : 'border-lime-300/60 bg-lime-600/65'
        " @pointerdown.stop="onFartDown" @pointerup.stop="onFartUp" @pointercancel.stop="onFartUp"
      @lostpointercapture="onFartUp">
      <span class="text-xl leading-none">💨</span>
      <span>放屁</span>
    </button>
  </div>
</template>
