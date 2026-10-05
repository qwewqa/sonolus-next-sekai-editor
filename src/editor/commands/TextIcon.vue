<script setup lang="ts">
defineProps<{
    title: string
    /** Fill classes for a chip behind the text, for canvas object colors (dark text). */
    chip?: string
}>()
</script>

<template>
    <div class="flex items-center justify-center whitespace-nowrap text-xs">
        <span v-if="chip" class="rounded-sm px-0.5 leading-4 text-on-accent" :class="chip">{{
            title
        }}</span>
        <template v-else>{{ title }}</template>
    </div>
</template>
