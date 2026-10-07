<script setup lang="ts">
defineProps<{
    fill: string
    /** The generic event: a ring in the text colour under high contrast, as monochrome icons. */
    monochrome?: boolean
}>()
</script>

<template>
    <svg viewBox="-0.5 -0.5 1 1">
        <circle
            class="stroke-fg"
            :class="{ 'forced-colors:fill-transparent forced-colors:stroke-current': monochrome }"
            cx="0"
            cy="0"
            r="0.25"
            stroke-width="0.05"
            :fill
        />
    </svg>
</template>
