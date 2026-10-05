<script setup lang="ts">
// No color is Default, which each object resolves itself: a dashed ring.
defineProps<{
    color?: string
    edge?: string
}>()
</script>

<template>
    <svg class="size-3.5 shrink-0" viewBox="0 0 16 16" aria-hidden="true">
        <circle
            v-if="color"
            cx="8"
            cy="8"
            r="6"
            :fill="color"
            :stroke="edge ?? 'rgb(68 68 102 / 0.45)'"
            stroke-width="1"
        />
        <circle
            v-else
            cx="8"
            cy="8"
            r="5.5"
            fill="none"
            stroke="currentColor"
            stroke-opacity="0.6"
            stroke-width="1.5"
            stroke-dasharray="2.2 2"
        />
    </svg>
</template>
