<script setup lang="ts">
import { provide } from 'vue'
import { i18n } from '../../../i18n'
import { stackLongValuesKey } from '../../../modals/form/fieldLayout'
import { tool } from '../../tools'

// Long values go below their label, as in Selection, View and the brush.
provide(stackLongValuesKey, true)
</script>

<template>
    <component :is="tool.sidebar" v-if="tool.sidebar" />
    <p v-else class="text-fg/80">{{ i18n.workspace.properties.noTool }}</p>
</template>
