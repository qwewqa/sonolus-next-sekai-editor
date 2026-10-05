<script setup lang="ts">
import { i18n } from '../../../i18n'
import ToolSettings from '../../workspace/properties/ToolSettings.vue'
import DefaultSlidePropertiesFields from './DefaultSlidePropertiesFields.vue'
</script>

<template>
    <ToolSettings :title="i18n.tools.slide.sidebar.title">
        <DefaultSlidePropertiesFields />
    </ToolSettings>
</template>
