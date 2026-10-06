<script setup lang="ts">
defineProps<{
    title: string
}>()
</script>

<template>
    <!-- The Properties panel owns the section header; this names what the
    current tool's settings apply to. -->
    <h3 class="text-sm font-bold">{{ title }}</h3>
    <slot />
</template>
