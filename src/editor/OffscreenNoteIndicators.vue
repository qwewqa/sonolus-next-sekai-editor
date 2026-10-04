<script setup lang="ts">
import { computed } from 'vue'
import { i18n } from '../i18n'
import { interpolateRaw } from '../utils/interpolate'
import { groupOffscreenNotes, type OffscreenNotePosition } from './offscreenNotes'

const props = defineProps<{
    notes: OffscreenNotePosition[]
    width: number
    top: number
    bottom: number
}>()
const indicators = computed(() =>
    groupOffscreenNotes(props.notes, props.width, props.top, props.bottom),
)
</script>

<template>
    <div class="pointer-events-none absolute inset-0 overflow-hidden">
        <div
            v-for="indicator in indicators"
            :key="`${indicator.side}:${indicator.slot}`"
            class="offscreen-note-indicator absolute flex h-6 -translate-y-1/2 items-center gap-0.5 rounded-full border bg-preview px-1 text-xs tabular-nums text-white shadow-sm"
            :class="[
                indicator.side === 'left' ? 'left-1' : 'right-1 flex-row-reverse',
                indicator.highlighted ? 'border-white' : 'border-white/25',
            ]"
            :style="{ top: `${indicator.y}px`, opacity: indicator.opacity }"
            :data-side="indicator.side"
            :data-count="indicator.count"
            role="img"
            :aria-label="
                interpolateRaw(i18n.offscreenNotes[indicator.side], String(indicator.count))
            "
        >
            <svg
                class="size-3 shrink-0"
                :class="{ 'rotate-180': indicator.side === 'right' }"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                aria-hidden="true"
            >
                <path d="m10 3-5 5 5 5" />
            </svg>
            <span>{{ indicator.count }}</span>
        </div>
    </div>
</template>
