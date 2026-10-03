<script setup lang="ts">
import { i18n } from '../../i18n'
import KeyField from '../../modals/form/KeyField.vue'
import { settings } from '../../settings'
import { commands, type CommandName } from '../commands'
import SettingsSection from './SettingsSection.vue'

const getKey = (name: CommandName) => settings.keyboardShortcuts[name]

const setKey = (name: CommandName, key: string | undefined) => {
    const shortcuts = { ...settings.keyboardShortcuts }
    if (key === undefined) Reflect.deleteProperty(shortcuts, name)
    else shortcuts[name] = key
    settings.keyboardShortcuts = shortcuts
}
</script>

<template>
    <SettingsSection :title="i18n.settings.keyboardShortcuts.title">
        <KeyField
            v-for="(command, name) in commands"
            :key="name"
            :label="command.title()"
            :model-value="getKey(name)"
            @update:model-value="setKey(name, $event)"
        />
    </SettingsSection>
</template>
