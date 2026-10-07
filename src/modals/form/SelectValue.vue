<script setup lang="ts">
defineProps<{
    value: string | undefined
}>()
</script>

<template>
    <!-- The value as the field draws it over a shared list's select, which can't truncate. -->
    <span class="select-value" aria-hidden="true"
        ><span>{{ value }}</span></span
    >
</template>
