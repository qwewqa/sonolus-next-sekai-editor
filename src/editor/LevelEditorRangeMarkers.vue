<script setup lang="ts">
import { beats, times } from '.'
import { settings } from '../settings'
import { formatTime } from '../utils/format'
import { formatBeatPosition } from './beatDisplay'
import { sceneBpms } from './sceneState'
</script>

<template>
    <div class="absolute flex size-full flex-col justify-between text-white/50">
        <div class="flex justify-between">
            <span>{{ formatTime(times.max) }}</span>
            <span>{{ formatBeatPosition(sceneBpms, beats.max, settings.beatDisplay, true) }}</span>
        </div>
        <div class="flex justify-between">
            <span>{{ formatTime(times.min) }}</span>
            <span>{{ formatBeatPosition(sceneBpms, beats.min, settings.beatDisplay, true) }}</span>
        </div>
    </div>
</template>
