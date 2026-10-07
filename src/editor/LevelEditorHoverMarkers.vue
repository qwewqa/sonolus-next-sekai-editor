<script setup lang="ts">
import { computed } from 'vue'
import { settings } from '../settings'
import { timeToBeat } from '../state/integrals/bpms'
import { formatTime } from '../utils/format'
import { formatBeatPosition } from './beatDisplay'
import { sceneBpms } from './sceneState'
import { view } from './view'

const hover = computed(() => ({
    top: 0.5 * view.h - (view.hoverTime - view.time) * settings.pps,
    time: view.hoverTime,
    beat: timeToBeat(sceneBpms.value, view.hoverTime),
}))
</script>

<template>
    <div
        class="absolute flex w-full -translate-y-1/2 justify-between text-white/70 forced-color-adjust-none"
        :style="{ top: `${hover.top}px` }"
    >
        <span>{{ formatTime(hover.time) }}</span>
        <span>{{ formatBeatPosition(sceneBpms, hover.beat, settings.beatDisplay, true) }}</span>
    </div>
</template>
