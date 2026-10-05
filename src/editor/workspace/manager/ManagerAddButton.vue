<script setup lang="ts">
import AddIcon from './icons/AddIcon.vue'

defineProps<{ label: string }>()
</script>

<template>
    <!-- A raised white pill, laid out like a row: the plus on the eye column,
    the label on the names. -->
    <button
        type="button"
        class="manager-add pointer-events-auto flex items-center rounded-full bg-button p-0.5 pr-4 shadow-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg active:bg-accent active:text-on-accent [@media(hover:hover)]:hover:shadow-accent"
    >
        <span
            class="flex size-9 shrink-0 items-center justify-center [@media(pointer:coarse)]:size-11"
        >
            <AddIcon
                class="size-4 fill-current [@media(pointer:coarse)]:size-5"
                aria-hidden="true"
            />
        </span>
        <span class="pl-2 [@media(pointer:coarse)]:pl-2.5">{{ label }}</span>
    </button>
</template>
