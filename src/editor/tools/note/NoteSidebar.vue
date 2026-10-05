<script setup lang="ts">
import { i18n } from '../../../i18n'
import ToolSettings from '../../workspace/properties/ToolSettings.vue'
import DefaultNotePropertiesFields from './DefaultNotePropertiesFields.vue'
</script>

<template>
    <ToolSettings :title="i18n.tools.note.sidebar.title">
        <DefaultNotePropertiesFields />
    </ToolSettings>
</template>
