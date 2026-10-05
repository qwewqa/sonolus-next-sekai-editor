<script setup lang="ts">
import { provide } from 'vue'
import { emptyLabelKey } from './emptyLabel'

const props = defineProps<{
    label: string
}>()

provide(emptyLabelKey, () => props.label)
</script>

<template>
    <slot />
</template>
