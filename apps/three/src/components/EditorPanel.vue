<script setup lang="ts">
import { ref } from 'vue'
import {
  LEVEL_01,
  parseLevelJson,
  serializeLevelJson,
  type LevelData,
} from '@toot/sim-core'
import type { EditorTool } from '../engine/ThreeStage'

const props = defineProps<{
  level: LevelData
  selectedTool: EditorTool
}>()

const emit = defineEmits<{
  'select-tool': [tool: EditorTool]
  'update-meta': [meta: { name: string; fartQuota: number; parTime: number; parPresses: number }]
  'import-level': [level: LevelData]
  'play-level': []
}>()

const TOOLS: ReadonlyArray<{ id: EditorTool; label: string; size: string; badge: string }> = [
  { id: 'bed', label: '床', size: '3×3×1', badge: '🛏️' },
  { id: 'desk', label: '書桌', size: '2×1×3', badge: '🖥️' },
  { id: 'chair', label: '椅子', size: '1×1×1', badge: '🪑' },
  { id: 'cat', label: '貓起點', size: '1×1×1', badge: '🐱' },
  { id: 'human', label: '人起點', size: '1×1×3', badge: '🧑' },
  { id: 'erase', label: '刪除家具', size: '橡皮擦', badge: '🗑️' },
]

const showImportBox = ref(false)
const importText = ref('')
const feedbackMsg = ref<{ text: string; isError: boolean } | null>(null)

function showFeedback(text: string, isError = false): void {
  feedbackMsg.value = { text, isError }
  window.setTimeout(() => {
    if (feedbackMsg.value?.text === text) {
      feedbackMsg.value = null
    }
  }, 3000)
}

function onMetaInput(field: 'name' | 'fartQuota' | 'parTime' | 'parPresses', raw: string): void {
  const next = {
    name: props.level.name,
    fartQuota: props.level.fartQuota,
    parTime: props.level.parTime,
    parPresses: props.level.parPresses,
  }
  if (field === 'name') {
    next.name = raw
  } else {
    const num = Number(raw)
    if (!Number.isFinite(num) || num <= 0) return
    next[field] = field === 'parPresses' ? Math.round(num) : num
  }
  emit('update-meta', next)
}

async function copyJson(): Promise<void> {
  const json = serializeLevelJson(props.level)
  try {
    await navigator.clipboard.writeText(json)
    showFeedback('已複製關卡 JSON 到剪貼簿！')
  } catch {
    importText.value = json
    showImportBox.value = true
    showFeedback('無法自動複製，已顯示在下方文字框')
  }
}

function downloadJson(): void {
  const json = serializeLevelJson(props.level)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${props.level.id || 'level'}.json`
  a.click()
  URL.revokeObjectURL(url)
  showFeedback('已下載關卡 JSON！')
}

function openImport(): void {
  importText.value = serializeLevelJson(props.level)
  showImportBox.value = !showImportBox.value
}

function applyImport(): void {
  try {
    const parsed = parseLevelJson(importText.value)
    emit('import-level', parsed)
    showImportBox.value = false
    showFeedback(`已匯入「${parsed.name}」！`)
  } catch (err) {
    showFeedback(err instanceof Error ? err.message : '匯入失敗', true)
  }
}

function resetDefault(): void {
  emit('import-level', LEVEL_01)
  showFeedback('已還原預設關卡')
}
</script>

<template>
  <aside
    class="absolute bottom-4 left-4 top-4 z-20 flex w-72 flex-col gap-3 overflow-y-auto rounded-2xl border border-slate-700/80 bg-slate-950/88 p-4 text-xs text-slate-200 shadow-2xl backdrop-blur"
    @pointerdown.stop
  >
    <div class="flex items-center justify-between border-b border-slate-800 pb-2.5">
      <div>
        <h2 class="text-sm font-bold text-white">🛠️ 極簡關卡編輯器</h2>
        <p class="text-[11px] text-slate-400">左鍵放置／右鍵輕點刪除家具</p>
      </div>
    </div>

    <!-- 預製件工具列 -->
    <div class="space-y-1.5">
      <p class="font-medium text-slate-300">選擇物件</p>
      <div class="grid grid-cols-2 gap-1.5">
        <button
          v-for="t in TOOLS"
          :key="t.id"
          type="button"
          class="flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition"
          :class="
            selectedTool === t.id
              ? 'border-sky-400 bg-sky-500/25 text-white'
              : 'border-slate-700/80 bg-slate-900/70 text-slate-300 hover:bg-slate-800'
          "
          @click="emit('select-tool', t.id)"
        >
          <span class="text-base leading-none">{{ t.badge }}</span>
          <div class="leading-tight">
            <p class="font-medium">{{ t.label }}</p>
            <p class="text-[10px] text-slate-400">{{ t.size }}</p>
          </div>
        </button>
      </div>
    </div>

    <!-- 關卡參數 -->
    <div class="space-y-2 border-t border-slate-800 pt-2.5">
      <p class="font-medium text-slate-300">關卡設定</p>
      <label class="block">
        <span class="text-[11px] text-slate-400">關卡名稱</span>
        <input
          type="text"
          :value="level.name"
          class="mt-0.5 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white focus:border-sky-400 focus:outline-none"
          @input="onMetaInput('name', ($event.target as HTMLInputElement).value)"
        />
      </label>
      <div class="grid grid-cols-3 gap-1.5">
        <label class="block">
          <span class="text-[10px] text-slate-400">屁額度</span>
          <input
            type="number"
            min="20"
            max="500"
            step="10"
            :value="level.fartQuota"
            class="mt-0.5 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-xs text-white focus:border-sky-400 focus:outline-none"
            @change="onMetaInput('fartQuota', ($event.target as HTMLInputElement).value)"
          />
        </label>
        <label class="block">
          <span class="text-[10px] text-slate-400">標準秒數</span>
          <input
            type="number"
            min="10"
            max="300"
            step="5"
            :value="level.parTime"
            class="mt-0.5 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-xs text-white focus:border-sky-400 focus:outline-none"
            @change="onMetaInput('parTime', ($event.target as HTMLInputElement).value)"
          />
        </label>
        <label class="block">
          <span class="text-[10px] text-slate-400">標準次數</span>
          <input
            type="number"
            min="1"
            max="20"
            step="1"
            :value="level.parPresses"
            class="mt-0.5 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-xs text-white focus:border-sky-400 focus:outline-none"
            @change="onMetaInput('parPresses', ($event.target as HTMLInputElement).value)"
          />
        </label>
      </div>
    </div>

    <!-- 匯出 / 匯入 JSON -->
    <div class="space-y-1.5 border-t border-slate-800 pt-2.5">
      <p class="font-medium text-slate-300">JSON 匯出 / 匯入</p>
      <div class="grid grid-cols-2 gap-1.5">
        <button
          type="button"
          class="cursor-pointer rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 font-medium hover:bg-slate-800"
          @click="copyJson"
        >
          📋 複製 JSON
        </button>
        <button
          type="button"
          class="cursor-pointer rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 font-medium hover:bg-slate-800"
          @click="downloadJson"
        >
          💾 下載檔案
        </button>
        <button
          type="button"
          class="cursor-pointer rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 font-medium hover:bg-slate-800"
          @click="openImport"
        >
          📥 貼上匯入
        </button>
        <button
          type="button"
          class="cursor-pointer rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 font-medium text-slate-300 hover:bg-slate-800"
          @click="resetDefault"
        >
          ↩️ 還原預設
        </button>
      </div>

      <div v-if="showImportBox" class="space-y-1.5 pt-1">
        <textarea
          v-model="importText"
          rows="6"
          class="w-full rounded-lg border border-slate-700 bg-slate-900 p-2 font-mono text-[11px] text-slate-200 focus:border-sky-400 focus:outline-none"
        />
        <button
          type="button"
          class="w-full cursor-pointer rounded-lg bg-sky-600 py-1.5 font-bold text-white hover:bg-sky-500"
          @click="applyImport"
        >
          套用 JSON
        </button>
      </div>

      <p
        v-if="feedbackMsg"
        class="rounded-md px-2 py-1 text-[11px]"
        :class="
          feedbackMsg.isError
            ? 'bg-rose-950/80 text-rose-300'
            : 'bg-emerald-950/80 text-emerald-300'
        "
      >
        {{ feedbackMsg.text }}
      </p>
    </div>

    <!-- 底部：套用並試玩 -->
    <div class="mt-auto border-t border-slate-800 pt-3">
      <button
        type="button"
        class="w-full cursor-pointer rounded-xl bg-emerald-600 py-2.5 text-sm font-bold text-white shadow-lg transition hover:bg-emerald-500"
        @click="emit('play-level')"
      >
        ▶ 套用並試玩關卡
      </button>
    </div>
  </aside>
</template>
