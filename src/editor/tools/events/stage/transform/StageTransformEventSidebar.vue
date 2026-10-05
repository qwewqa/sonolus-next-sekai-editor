<script setup lang="ts">
import { i18n } from '../../../../../i18n/index.ts'
import { interpolateRaw } from '../../../../../utils/interpolate.ts'
import ToolSettings from '../../../../workspace/properties/ToolSettings.vue'
import DefaultStageTransformEventPropertiesFields from './DefaultStageTransformEventPropertiesFields.vue'
</script>

<template>
    <ToolSettings
        :title="interpolateRaw(i18n.tools.events.sidebar.title, i18n.events.stageTransformEvent)"
    >
        <DefaultStageTransformEventPropertiesFields />
    </ToolSettings>
</template>
