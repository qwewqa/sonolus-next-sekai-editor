<script setup lang="ts">
import type { ScaleAxis } from '../../../state/operations/scaleValues'

defineProps<{ axis: ScaleAxis }>()
</script>

<template>
    <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
    >
        <path v-if="axis === 'width'" d="M4 5v14M20 5v14M7 12h10m-7-3-3 3 3 3m4-6 3 3-3 3" />
        <template v-else>
            <path d="M17 4v16m-3-13 3-3 3 3m-6 10 3 3 3-3" />
            <path v-if="axis === 'beat'" d="M4 4h6M4 8h3M4 12h6M4 16h3M4 20h6" />
            <path v-else d="M3 19h3v-5h3V9h3V4" />
        </template>
    </svg>
</template>
