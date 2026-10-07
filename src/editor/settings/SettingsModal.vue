<script setup lang="ts">
import { i18n } from '../../i18n'
import BaseModal from '../../modals/BaseModal.vue'
import { resetKeybinds, resetSettings } from '../../settings'
import SettingsEditor from './SettingsEditor.vue'
import SettingsKeyboardShortcuts from './SettingsKeyboardShortcuts.vue'
import SettingsMouse from './SettingsMouse.vue'
import SettingsPanels from './SettingsPanels.vue'
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
                class="h-9 min-w-24 max-w-full truncate rounded-full bg-button px-4 shadow-md outline-none transition-colors hover:shadow-accent focus-visible:ring-2 focus-visible:ring-fg active:bg-accent active:text-on-accent [@media(pointer:coarse)]:h-11"
                :title="i18n.settings.resetSettingsHint"
                @click="resetSettings"
            >
                {{ i18n.settings.resetSettings }}
            </button>
            <button
                type="button"
                class="h-9 min-w-24 max-w-full truncate rounded-full bg-button px-4 shadow-md outline-none transition-colors hover:shadow-accent focus-visible:ring-2 focus-visible:ring-fg active:bg-accent active:text-on-accent [@media(pointer:coarse)]:h-11"
                @click="resetKeybinds"
            >
                {{ i18n.settings.resetKeybinds }}
            </button>
        </div>
        <SettingsEditor />

        <SettingsPanels />

        <SettingsPreview />

        <SettingsToolbar />

        <SettingsPlay />

        <SettingsTouch />

        <SettingsMouse />

        <SettingsKeyboardShortcuts />
    </BaseModal>
</template>
