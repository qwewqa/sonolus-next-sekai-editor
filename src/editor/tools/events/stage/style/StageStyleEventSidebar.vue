<script setup lang="ts">
import { i18n } from '../../../../../i18n'
import { interpolateRaw } from '../../../../../utils/interpolate'
import ToolSettings from '../../../../workspace/properties/ToolSettings.vue'
import DefaultStageStyleEventPropertiesFields from './DefaultStageStyleEventPropertiesFields.vue'
</script>

<template>
    <ToolSettings
        :title="interpolateRaw(i18n.tools.events.sidebar.title, i18n.events.stageStyleEvent)"
    >
        <DefaultStageStyleEventPropertiesFields />
    </ToolSettings>
</template>
