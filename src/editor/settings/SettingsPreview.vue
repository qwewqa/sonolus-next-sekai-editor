<script setup lang="ts">
import { i18n } from '../../i18n'
import NumberField from '../../modals/form/NumberField.vue'
import SelectField from '../../modals/form/SelectField.vue'
import ToggleField from '../../modals/form/ToggleField.vue'
import { previewAspectRatios, previewNoteSpeed, previewRenderScale } from '../../preview/options'
import { previewControlOptions, previewTransportOptions } from '../../preview/settingsOptions'
import { settings } from '../../settings'
import SettingsSection from './SettingsSection.vue'

// Same order and labels as the preview's own settings form. Placement is under Panels.
</script>

<template>
    <SettingsSection :title="i18n.settings.preview.title">
        <NumberField
            v-model="settings.previewNoteSpeed"
            :label="i18n.settings.preview.noteSpeed"
            :min="previewNoteSpeed.min"
            :max="previewNoteSpeed.max"
            :step="previewNoteSpeed.step"
        />
        <ToggleField
            v-model="settings.previewHighlightSelection"
            :label="i18n.settings.preview.highlightSelection"
        />
        <ToggleField
            v-model="settings.previewShowHitboxes"
            :label="i18n.settings.preview.showHitboxes"
        />
        <ToggleField
            v-model="settings.previewShowEffects"
            :label="i18n.settings.preview.showEffects"
        />
        <ToggleField v-model="settings.previewShowTime" :label="i18n.settings.preview.showTime" />
        <SelectField
            v-model="settings.previewAspectRatio"
            :label="i18n.settings.preview.aspectRatio"
            :options="previewAspectRatios"
        />
        <NumberField
            v-model="settings.previewRenderScale"
            :label="i18n.settings.preview.renderScale"
            :min="previewRenderScale.min"
            :max="previewRenderScale.max"
            :step="previewRenderScale.step"
        />
        <ToggleField v-model="settings.previewAntialias" :label="i18n.settings.preview.antialias" />
        <SelectField
            v-model="settings.previewTransportPosition"
            :label="i18n.settings.preview.transport.title"
            :options="previewTransportOptions"
        />
        <SelectField
            v-model="settings.previewControls"
            :label="i18n.settings.preview.controls.title"
            :options="previewControlOptions"
        />
    </SettingsSection>
</template>
