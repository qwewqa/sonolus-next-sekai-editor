<script setup lang="ts">
import { computed } from 'vue'
import { settings } from '../../settings'
import { formatShortcut } from '../../utils/format'
import { commands, type CommandName } from '../commands'
import { isCoarsePointer } from '../workspace'

const props = defineProps<{
    name: CommandName
    showLabel?: boolean
}>()

const title = computed(() => commands[props.name].title())

// Tools float over the dark canvas (accent focus ring) and also sit in the light
// Settings dialog (fg ring). Labelled flyout items get a 44px target on touch,
// and drop the shortcut hints there, as the context menu does.
const shortcut = computed(() =>
    isCoarsePointer.value ? undefined : formatShortcut(settings.keyboardShortcuts[props.name]),
)
</script>

<template>
    <button
        class="flex items-center rounded-full bg-button p-2 shadow-md transition-colors hover:shadow-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent active:bg-accent active:fill-on-accent active:text-on-accent [dialog_&]:focus-visible:ring-fg"
        :class="{ '[@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:px-3': showLabel }"
        :title
    >
        <component :is="commands[name].icon.is" class="size-4" v-bind="commands[name].icon.props" />
        <template v-if="showLabel">
            <span class="ml-2 flex-grow text-left text-sm">{{ title }}</span>
            <span v-if="shortcut" class="ml-4 text-xs text-fg/80">{{ shortcut }}</span>
        </template>
    </button>
</template>
