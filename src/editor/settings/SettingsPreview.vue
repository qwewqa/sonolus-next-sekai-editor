<script setup lang="ts">
import { i18n } from '../../i18n'
import NumberField from '../../modals/form/NumberField.vue'
import SelectField from '../../modals/form/SelectField.vue'
import ToggleField from '../../modals/form/ToggleField.vue'
import { settings } from '../../settings'
import SettingsSection from './SettingsSection.vue'
</script>

<template>
    <SettingsSection :title="i18n.settings.preview.title">
        <ToggleField v-model="settings.showPreview" :label="i18n.settings.preview.showPreview" />
        <NumberField
            v-model="settings.previewNoteSpeed"
            :label="i18n.settings.preview.noteSpeed"
            :min="1"
            :max="12"
            :step="0.01"
        />
        <NumberField
            v-model="settings.previewRenderScale"
            :label="i18n.settings.preview.renderScale"
            :min="0.25"
            :max="2"
            :step="0.25"
        />
        <SelectField
            v-model="settings.previewAspectRatio"
            :label="i18n.settings.preview.aspectRatio"
            :options="[
                ['16:9', 16 / 9],
                ['21:9', 21 / 9],
                ['4:3', 4 / 3],
            ]"
        />
        <ToggleField
            v-model="settings.previewShowEffects"
            :label="i18n.settings.preview.showEffects"
        />
        <ToggleField v-model="settings.previewAntialias" :label="i18n.settings.preview.antialias" />
        <SelectField
            v-model="settings.previewControls"
            :label="i18n.settings.preview.controls.title"
            :options="[
                [i18n.settings.preview.controls.auto, 'auto'],
                [i18n.settings.preview.controls.expanded, 'expanded'],
                [i18n.settings.preview.controls.collapsed, 'collapsed'],
            ]"
        />
        <SelectField
            v-model="settings.previewPosition"
            :label="i18n.settings.preview.position.title"
            :options="[
                [i18n.settings.preview.position.auto, 'auto'],
                [i18n.settings.preview.position.top, 'top'],
                [i18n.settings.preview.position.left, 'left'],
            ]"
        />
    </SettingsSection>
</template>
