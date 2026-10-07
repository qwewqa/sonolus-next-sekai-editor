<script setup lang="ts">
import { onBeforeUnmount, onMounted, useTemplateRef } from 'vue'
import { beats, times } from '.'
import { settings } from '../settings'
import { formatTime } from '../utils/format'
import { formatBeatPosition } from './beatDisplay'
import {
    edgeLabelSizes,
    lowerEdgeLabelsCovered,
    observeLabelSize,
    unobserveLabelSize,
} from './edgeLabels'
import { sceneBpms } from './sceneState'

// The grid leaves out its own labels under these.
const labels = {
    top: { time: useTemplateRef('topTime'), beat: useTemplateRef('topBeat') },
    bottom: { time: useTemplateRef('bottomTime'), beat: useTemplateRef('bottomBeat') },
}
const elements = () =>
    (['top', 'bottom'] as const).flatMap((row) =>
        (['time', 'beat'] as const).map(
            (label) => [labels[row][label].value, edgeLabelSizes[row][label]] as const,
        ),
    )
onMounted(() => {
    for (const [element, size] of elements()) if (element) observeLabelSize(element, size)
})
onBeforeUnmount(() => {
    for (const [element] of elements()) if (element) unobserveLabelSize(element)
})
</script>

<template>
    <div
        class="absolute flex size-full flex-col justify-between text-white/70 forced-color-adjust-none"
    >
        <div class="flex justify-between">
            <span ref="topTime">{{ formatTime(times.max) }}</span>
            <span ref="topBeat">{{
                formatBeatPosition(sceneBpms, beats.max, settings.beatDisplay, true)
            }}</span>
        </div>
        <div class="flex justify-between" :class="{ invisible: lowerEdgeLabelsCovered }">
            <span ref="bottomTime">{{ formatTime(times.min) }}</span>
            <span ref="bottomBeat">{{
                formatBeatPosition(sceneBpms, beats.min, settings.beatDisplay, true)
            }}</span>
        </div>
    </div>
</template>
