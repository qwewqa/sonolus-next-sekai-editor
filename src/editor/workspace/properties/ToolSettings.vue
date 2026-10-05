<script setup lang="ts">
defineProps<{
    title: string
}>()
</script>

<template>
    <!-- The Properties panel owns the section header; this names what the
    current tool's settings apply to. -->
    <p class="text-sm font-medium text-fg/80">{{ title }}</p>
    <slot />
</template>
