<script setup lang="ts">
import { i18n } from '../../../i18n'
import ToolSettings from '../../workspace/properties/ToolSettings.vue'
import BrushPropertiesFields from './BrushPropertiesFields.vue'
</script>

<template>
    <ToolSettings :title="i18n.tools.brush.sidebar.title">
        <BrushPropertiesFields />
    </ToolSettings>
</template>
