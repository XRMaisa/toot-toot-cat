<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { GRID } from '@toot/sim-core'
import { ThreeStage } from './engine/ThreeStage'

const container = ref<HTMLDivElement>()
let stage: ThreeStage | undefined

onMounted(() => {
  if (container.value) stage = new ThreeStage(container.value)
})

onBeforeUnmount(() => stage?.dispose())
</script>

<template>
  <div class="relative h-full w-full bg-slate-900">
    <div ref="container" class="absolute inset-0" />
    <div
      class="pointer-events-none absolute left-4 top-4 rounded-lg bg-black/50 px-4 py-2 text-sm text-white"
    >
      <p class="font-bold">🐱💨 Toot Toot Cat · Three.js</p>
      <p class="text-slate-300">Grid {{ GRID.NX }} × {{ GRID.NY }} × {{ GRID.NZ }}</p>
    </div>
  </div>
</template>
