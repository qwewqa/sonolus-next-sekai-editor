<script setup lang="ts">
import { i18n } from '../../i18n'
import NumberField from '../../modals/form/NumberField.vue'
import SelectField from '../../modals/form/SelectField.vue'
import ToggleField from '../../modals/form/ToggleField.vue'
import { previewAspectRatios, previewNoteSpeed, previewRenderScale } from '../../preview/options'
import { previewControlOptions, previewPositionOptions } from '../../preview/settingsOptions'
import { settings } from '../../settings'
import SettingsSection from './SettingsSection.vue'
</script>

<template>
    <SettingsSection :title="i18n.settings.preview.title">
        <ToggleField v-model="settings.showPreview" :label="i18n.settings.preview.showPreview" />
        <NumberField
            v-model="settings.previewNoteSpeed"
            :label="i18n.settings.preview.noteSpeed"
            :min="previewNoteSpeed.min"
            :max="previewNoteSpeed.max"
            :step="previewNoteSpeed.step"
        />
        <NumberField
            v-model="settings.previewRenderScale"
            :label="i18n.settings.preview.renderScale"
            :min="previewRenderScale.min"
            :max="previewRenderScale.max"
            :step="previewRenderScale.step"
        />
        <SelectField
            v-model="settings.previewAspectRatio"
            :label="i18n.settings.preview.aspectRatio"
            :options="previewAspectRatios"
        />
        <ToggleField
            v-model="settings.previewShowEffects"
            :label="i18n.settings.preview.showEffects"
        />
        <ToggleField v-model="settings.previewAntialias" :label="i18n.settings.preview.antialias" />
        <ToggleField
            v-model="settings.previewHighlightSelection"
            :label="i18n.settings.preview.highlightSelection"
        />
        <SelectField
            v-model="settings.previewControls"
            :label="i18n.settings.preview.controls.title"
            :options="previewControlOptions"
        />
        <SelectField
            v-model="settings.previewPosition"
            :label="i18n.settings.preview.position.title"
            :options="previewPositionOptions"
        />
    </SettingsSection>
</template>
