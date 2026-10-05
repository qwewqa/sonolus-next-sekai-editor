<script setup lang="ts">
import { i18n } from '../../../../i18n'
import { interpolateRaw } from '../../../../utils/interpolate'
import ToolSettings from '../../../workspace/properties/ToolSettings.vue'
import DefaultCameraEventPropertiesFields from './DefaultCameraEventPropertiesFields.vue'
</script>

<template>
    <ToolSettings :title="interpolateRaw(i18n.tools.events.sidebar.title, i18n.events.cameraEvent)">
        <DefaultCameraEventPropertiesFields />
    </ToolSettings>
</template>
