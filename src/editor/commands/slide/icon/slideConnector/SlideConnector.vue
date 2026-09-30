<script setup lang="ts">
import { computed } from 'vue'
import type { DefaultNoteSlideProperties } from '../../../../../settings'
import { connectorColors } from '../../../../utils/connectorColors'

const props = defineProps<{
    properties: DefaultNoteSlideProperties
}>()

const colors = computed(() => connectorColors(props.properties))
</script>

<template>
    <rect
        x="-0.5"
        y="0"
        width="1"
        height="0.55"
        :fill="colors.body"
        :fill-opacity="properties.connectorType === 'guide' ? 0.5 : 0.8"
    />
    <path
        v-if="colors.edge"
        d="M -0.5 0 V 0.55 M 0.5 0 V 0.55"
        fill="none"
        :stroke="colors.edge"
        stroke-opacity="0.8"
        stroke-width="0.08"
    />
    <template
        v-if="
            properties.connectorType !== 'guide' &&
            (properties.connectorIsFake ?? properties.isFake)
        "
    >
        <line x1="-0.5" y1="0" x2="0.5" y2="0.55" stroke="#f44" stroke-width="0.1" />
        <line x1="-0.5" y1="0.55" x2="0.5" y2="0" stroke="#f44" stroke-width="0.1" />
    </template>
</template>
