<script setup lang="ts">
import { computed } from 'vue'
import type { NoteStyle } from '../../chart/noteStyle'
import { connectorStyleColor, noteStyleColors } from '../../utils/colors'
import ColorSwatch from './ColorSwatch.vue'

// The note body and edge, or the connector base, as the editor draws them.
const props = defineProps<{
    value: NoteStyle
    connector?: boolean
}>()

const colors = computed(() => {
    if (props.value === 'default') return {}
    if (props.connector) return { color: connectorStyleColor(props.value) }
    const [body, , edge] = noteStyleColors[props.value]
    return { color: body, edge }
})
</script>

<template>
    <ColorSwatch v-bind="colors" />
</template>
