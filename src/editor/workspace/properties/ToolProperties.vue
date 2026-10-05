<script setup lang="ts">
import { i18n } from '../../../i18n'
import { tool } from '../../tools'
</script>

<template>
    <component :is="tool.sidebar" v-if="tool.sidebar" />
    <p v-else class="text-fg/80">{{ i18n.workspace.properties.noTool }}</p>
</template>
