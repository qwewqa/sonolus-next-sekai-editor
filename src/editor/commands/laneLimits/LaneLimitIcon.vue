<script setup lang="ts">
defineProps<{ mode: 'none' | 'six' | 'custom' }>()
</script>

<template>
    <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
            d="M 5 3 H 2 V 21 H 5 M 19 3 H 22 V 21 H 19"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
        />
        <text x="12" y="16" text-anchor="middle" fill="currentColor" font-size="13">
            {{ mode === 'none' ? '∞' : mode === 'six' ? '6' : 'n' }}
        </text>
    </svg>
</template>
