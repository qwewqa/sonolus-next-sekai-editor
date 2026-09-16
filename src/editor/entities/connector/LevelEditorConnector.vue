<script setup lang="ts">
import { connectorComponents } from '.'
import type { ConnectorEntity } from '../../../state/entities/slides/connector'
import { isConnectorVisible } from '../visibility'

defineProps<{
    entity: ConnectorEntity
    isHighlighted: boolean
}>()
</script>

<template>
    <g v-if="isConnectorVisible(entity)">
        <component :is="connectorComponents[entity.attachHead.connectorEase]" :entity />
    </g>
</template>
