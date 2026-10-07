<script setup lang="ts">
import { watch } from 'vue'
import { bgm } from '../../history/bgm'
import { i18n } from '../../i18n'
import { localizations } from '../../i18n/localizations'
import { showModal } from '../../modals'
import NumberField from '../../modals/form/NumberField.vue'
import SelectField from '../../modals/form/SelectField.vue'
import ToggleField from '../../modals/form/ToggleField.vue'
import InfoModal from '../../modals/InfoModal.vue'
import { settings } from '../../settings'
import SettingsSection from './SettingsSection.vue'

watch(
    () => settings.waveform,
    (waveform) => {
        if (waveform === 'off') return
        if (!bgm.value.buffer) return

        void showModal(InfoModal, {
            title: () => i18n.value.settings.editor.waveformVisualization.title,
            message: () => i18n.value.settings.editor.waveformVisualization.changed,
        })
    },
)
</script>

<template>
    <SettingsSection :title="i18n.settings.editor.title">
        <SelectField
            v-model="settings.locale"
            :label="i18n.settings.editor.locale"
            :options="Object.entries(localizations).map(([locale, { title }]) => [title, locale])"
        />

        <SelectField
            v-model="settings.elevationEditorSideBySide"
            :label="i18n.settings.editor.elevationSideBySide"
            :options="[
                [i18n.elevation.auto, 'auto'],
                [i18n.elevation.allow, 'allow'],
                [i18n.elevation.disallow, 'disallow'],
            ]"
        />

        <ToggleField v-model="settings.autoSave" :label="i18n.settings.editor.autoSave" />

        <NumberField
            v-model="settings.autoSaveDelay"
            :label="i18n.settings.editor.autoSaveDelay"
            :min="0"
            :max="5"
            step="any"
        />

        <SelectField
            v-model="settings.beatDisplay"
            :label="i18n.settings.editor.beatDisplay.title"
            :options="[
                [i18n.settings.editor.beatDisplay.beat, 'beat'],
                [i18n.settings.editor.beatDisplay.measure, 'measure'],
                [i18n.settings.editor.beatDisplay.both, 'both'],
            ]"
        />

        <SelectField
            v-model="settings.waveform"
            :label="i18n.settings.editor.waveformVisualization.title"
            :options="[
                [i18n.settings.editor.waveformVisualization.volume, 'volume'],
                [i18n.settings.editor.waveformVisualization.fft, 'fft'],
                [i18n.settings.editor.waveformVisualization.off, 'off'],
            ]"
        />

        <SelectField
            v-model="settings.zeroWidthNotes"
            :label="i18n.settings.editor.zeroWidthNotes.title"
            :options="[
                [i18n.settings.editor.zeroWidthNotes.off, 'off'],
                [i18n.settings.editor.zeroWidthNotes.anchors, 'anchors'],
                [i18n.settings.editor.zeroWidthNotes.all, 'all'],
            ]"
        />

        <NumberField
            v-model="settings.maxScrollX"
            :label="i18n.settings.editor.maxScrollX"
            :min="0"
        />

        <ToggleField v-model="settings.dragToPanY" :label="i18n.settings.editor.dragToPanY" />

        <ToggleField v-model="settings.dragToPanX" :label="i18n.settings.editor.dragToPanX" />

        <ToggleField v-model="settings.autoAddGroup" :label="i18n.settings.editor.autoAddGroup" />

        <ToggleField v-model="settings.showGroupName" :label="i18n.settings.editor.showGroupName" />

        <ToggleField
            v-model="settings.showOtherGroups"
            :label="i18n.settings.editor.showOtherGroups"
        />

        <ToggleField v-model="settings.showStageName" :label="i18n.settings.editor.showStageName" />

        <ToggleField
            v-model="settings.showOtherStages"
            :label="i18n.settings.editor.showOtherStages"
        />

        <ToggleField
            v-model="settings.showOtherObjects"
            :label="i18n.settings.editor.showOtherObjects"
        />

        <ToggleField v-model="settings.nameContrast" :label="i18n.settings.editor.nameContrast" />

        <ToggleField
            v-model="settings.deselectSwitchesToSelect"
            :label="i18n.settings.editor.deselectSwitchesToSelect"
        />
    </SettingsSection>
</template>
