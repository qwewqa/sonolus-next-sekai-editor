<script setup lang="ts">
import { computed } from 'vue'
import type { Ease } from '../../ease'
import { easeGlyphPathD } from '../../easeGlyph'

// The ease's curve as the timeline draws it: time runs up, the value to the right.
const props = defineProps<{
    ease: Ease
}>()

const d = computed(() => easeGlyphPathD(props.ease, false, 2, 2, 12, 12))
</script>

<template>
    <svg
        class="size-4 shrink-0"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        stroke-width="1.75"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
    >
        <path :d />
    </svg>
</template>
