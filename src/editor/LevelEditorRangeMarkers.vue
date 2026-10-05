<script setup lang="ts">
import { computed } from 'vue'
import { beats, times } from '.'
import { settings } from '../settings'
import { formatTime } from '../utils/format'
import { formatBeatPosition } from './beatDisplay'
import { sceneBpms } from './sceneState'
import { hasToolModal } from './toolModals'
import { view } from './view'

// A docked dialog (up to 28rem wide, centered at the bottom) covers the lower
// labels in narrow panes; hidden there rather than left peeking out under its
// rounded corners.
const lowerCovered = computed(() => hasToolModal('main') && view.w < 640)
</script>

<template>
    <div class="absolute flex size-full flex-col justify-between text-white/70">
        <div class="flex justify-between">
            <span>{{ formatTime(times.max) }}</span>
            <span>{{ formatBeatPosition(sceneBpms, beats.max, settings.beatDisplay, true) }}</span>
        </div>
        <div class="flex justify-between" :class="{ invisible: lowerCovered }">
            <span>{{ formatTime(times.min) }}</span>
            <span>{{ formatBeatPosition(sceneBpms, beats.min, settings.beatDisplay, true) }}</span>
        </div>
    </div>
</template>
