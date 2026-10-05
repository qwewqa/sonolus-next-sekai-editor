<script setup lang="ts">
import type { TimeScaleTransition } from '../../chart/timeScale'

// The time scale marker: a circle, or a diamond of the same area for Scroll.
defineProps<{
    transition: TimeScaleTransition
}>()
</script>

<template>
    <svg class="size-3.5 shrink-0" viewBox="0 0 16 16" aria-hidden="true">
        <circle v-if="transition === 'timeScale'" cx="8" cy="8" r="4.5" fill="currentColor" />
        <polygon v-else points="8,1.9 14.1,8 8,14.1 1.9,8" fill="currentColor" />
    </svg>
</template>
