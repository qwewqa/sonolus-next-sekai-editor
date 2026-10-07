<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
    mode: 'none' | 'six' | 'custom'
    /** The custom limit in use, shown when it fits between the brackets. */
    value?: number
}>()

// Font sizes by length that keep the text inside the brackets.
const sizes = [13, 11]

const label = computed(() => {
    if (props.mode === 'none') return { text: '∞', size: 13 }
    if (props.mode === 'six') return { text: '6', size: 13 }
    const text = props.value === undefined ? '' : `${props.value}`
    const size = sizes[text.length - 1]
    return size ? { text, size } : { text: 'n', size: 13 }
})
</script>

<template>
    <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
            d="M 5 3 H 2 V 21 H 5 M 19 3 H 22 V 21 H 19"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
        />
        <text
            x="12"
            :y="12 + (label.size * 4) / 13"
            text-anchor="middle"
            fill="currentColor"
            :font-size="label.size"
        >
            {{ label.text }}
        </text>
    </svg>
</template>
