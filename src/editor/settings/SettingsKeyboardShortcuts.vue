<script setup lang="ts">
import { computed } from 'vue'
import { i18n } from '../../i18n'
import KeyField from '../../modals/form/KeyField.vue'
import { settings } from '../../settings'
import { interpolateRaw } from '../../utils/interpolate'
import { commands, type CommandName } from '../commands'
import {
    browserShortcutOf,
    commandChordBinding,
    normalizeBinding,
    parseChord,
} from '../controls/bindings'
import SettingsSection from './SettingsSection.vue'

const getKey = (name: CommandName) => settings.keyboardShortcuts[name]

// Unbinding saves '', so a later start can't mistake it for a new command.
const setKey = (name: CommandName, key: string | undefined) => {
    settings.keyboardShortcuts = { ...settings.keyboardShortcuts, [name]: key ?? '' }
}

// Commands sharing a binding all run; each row names the others.
const notes = computed(() => {
    const bound = (Object.entries(settings.keyboardShortcuts) as [CommandName, string][]).filter(
        ([, key]) => key,
    )
    const users = new Map<string, CommandName[]>()
    for (const [name, key] of bound) {
        const binding = normalizeBinding(key)
        users.set(binding, [...(users.get(binding) ?? []), name])
    }
    const { key: messages, listJoin } = i18n.value.modals.form
    const browser = {
        reload: messages.browserReload,
        find: messages.browserFind,
    }
    return new Map(
        bound.map(([name, key]) => {
            const others = (users.get(normalizeBinding(key)) ?? []).filter(
                (other) => other !== name,
            )
            const list: string[] = []
            if (others.length)
                list.push(
                    interpolateRaw(
                        messages.alsoRuns,
                        // Joined in the locale's punctuation, as "、" in Japanese.
                        others
                            .map((other) => commands[other].title())
                            .reduce((text, title) => interpolateRaw(listJoin, text, title)),
                    ),
                )
            // A plain key loses its Ctrl chord to a command bound to that chord exactly.
            const chord = parseChord(key) ? undefined : commandChordBinding(key)
            const kind = chord && users.has(chord) ? undefined : browserShortcutOf(key)
            if (kind) list.push(browser[kind])
            return [name, list]
        }),
    )
})
</script>

<template>
    <SettingsSection :title="i18n.settings.keyboardShortcuts.title">
        <KeyField
            v-for="(command, name) in commands"
            :key="name"
            :label="command.title()"
            :model-value="getKey(name)"
            :notes="notes.get(name)"
            @update:model-value="setKey(name, $event)"
        >
            <template #icon>
                <component
                    :is="command.icon.is"
                    class="h-4 w-auto min-w-4 fill-current"
                    v-bind="command.icon.props"
                />
            </template>
        </KeyField>
    </SettingsSection>
</template>
