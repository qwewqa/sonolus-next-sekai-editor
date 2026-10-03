<script setup lang="ts">
import { i18n } from '../../i18n'
import BaseModal from '../../modals/BaseModal.vue'
import { resetKeybinds, resetSettings } from '../../settings'
import SettingsEditor from './SettingsEditor.vue'
import SettingsKeyboardShortcuts from './SettingsKeyboardShortcuts.vue'
import SettingsMouse from './SettingsMouse.vue'
import SettingsPlay from './SettingsPlay.vue'
import SettingsPreview from './SettingsPreview.vue'
import SettingsTouch from './SettingsTouch.vue'
import SettingsToolbar from './toolbar/SettingsToolbar.vue'
</script>

<template>
    <BaseModal :title="i18n.settings.title">
        <div class="flex flex-wrap gap-2">
            <button
                type="button"
                class="rounded-full bg-button px-4 py-1 shadow-md transition-colors hover:shadow-accent active:bg-accent active:text-button"
                :title="i18n.settings.resetSettingsHint"
                @click="resetSettings"
            >
                {{ i18n.settings.resetSettings }}
            </button>
            <button
                type="button"
                class="rounded-full bg-button px-4 py-1 shadow-md transition-colors hover:shadow-accent active:bg-accent active:text-button"
                @click="resetKeybinds"
            >
                {{ i18n.settings.resetKeybinds }}
            </button>
        </div>
        <SettingsEditor />

        <SettingsPreview />

        <SettingsToolbar />

        <SettingsPlay />

        <SettingsTouch />

        <SettingsMouse />

        <SettingsKeyboardShortcuts />
    </BaseModal>
</template>
