<script setup lang="ts">
import { computed } from 'vue'
import type { FlickDirection } from '../../chart/note'
import { flickGlyphPoints } from '../../flickArrow'

// The note's flick arrow as the editor draws it.
const props = defineProps<{
    direction: Exclude<FlickDirection, 'none'>
}>()

const points = computed(() => flickGlyphPoints(props.direction, 8, 6.5))
</script>

<template>
    <svg class="size-3.5 shrink-0" viewBox="0 0 16 16" aria-hidden="true">
        <polygon :points fill="currentColor" />
    </svg>
</template>
