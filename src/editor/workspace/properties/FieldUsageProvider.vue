<script setup lang="ts">
import { provide, toRef } from 'vue'
import { fieldUsageKey, type FieldUsage } from '../../../modals/form/fieldUsage'

const props = defineProps<{
    usage: FieldUsage
}>()

provide(fieldUsageKey, toRef(props, 'usage'))
</script>

<template>
    <slot />
</template>
