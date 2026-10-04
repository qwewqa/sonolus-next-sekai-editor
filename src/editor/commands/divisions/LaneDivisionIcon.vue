<script setup lang="ts">
defineProps<{ title: string }>()
</script>

<template>
    <div
        aria-hidden="true"
        class="relative flex items-center justify-center whitespace-nowrap text-xs"
    >
        <svg
            class="absolute -top-1.5 h-1.5 w-4"
            viewBox="0 0 24 8"
            xmlns="http://www.w3.org/2000/svg"
        >
            <path
                d="M 3 4 H 21 M 6 1 L 3 4 L 6 7 M 18 1 L 21 4 L 18 7"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
            />
        </svg>
        <span>{{ title }}</span>
    </div>
</template>
