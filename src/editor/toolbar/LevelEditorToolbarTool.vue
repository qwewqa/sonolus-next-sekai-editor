<script setup lang="ts">
import { computed } from 'vue'
import { settings } from '../../settings'
import { formatShortcut, isPunctuationShortcut } from '../controls/bindings'
import { commands, type CommandName } from '../commands'
import { isCoarsePointer } from '../workspace'
import { pressedIconProps } from './pressed'

const props = withDefaults(
    defineProps<{
        name: CommandName
        showLabel?: boolean
        /** The tool or mode in use; only the editor's toolbar shows it. */
        pressed?: boolean
    }>(),
    { pressed: undefined },
)

const title = computed(() => commands[props.name].title())
// A pressed Custom member shows the value in use.
const iconProps = computed(
    () =>
        (props.pressed ? pressedIconProps(props.name) : undefined) ??
        commands[props.name].icon.props,
)

// Tools float over the dark canvas (accent focus ring) and also sit in the light
// Settings dialog (fg ring). Labelled flyout items get a 44px target on touch,
// and drop the shortcut hints there, as the context menu does. High contrast
// leaves SVG fills alone, so monochrome icons take ButtonText. The tool in use
// takes the selected look, unforced so its text gets no backplate. The
// transparent outline is the edge high contrast paints; inset, as tools sit close.
const shortcut = computed(() =>
    isCoarsePointer.value ? undefined : formatShortcut(settings.keyboardShortcuts[props.name]),
)
</script>

<template>
    <button
        class="flex items-center rounded-full p-2 shadow-md outline-none -outline-offset-2 transition-colors hover:shadow-accent focus-visible:ring-2 active:bg-accent active:fill-on-accent active:text-on-accent [dialog_&]:focus-visible:ring-fg"
        :class="[
            pressed
                ? 'bg-accent fill-on-accent text-on-accent focus-visible:ring-button forced-colors:bg-[Highlight] forced-colors:fill-[HighlightText] forced-colors:text-[HighlightText] forced-colors:outline-[color:HighlightText] forced-colors:forced-color-adjust-none forced-colors:![box-shadow:none] forced-colors:focus-visible:outline-[color:CanvasText] forced-colors:active:bg-[Highlight] forced-colors:active:fill-[HighlightText] forced-colors:active:text-[HighlightText]'
                : 'bg-button focus-visible:ring-accent forced-colors:fill-[ButtonText]',
            { '[@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:px-3': showLabel },
        ]"
        :title
        :aria-pressed="pressed"
    >
        <!-- Beside a label, icons share a 20px column so names line up. -->
        <span v-if="showLabel" class="flex w-5 shrink-0 justify-center" data-icon-column>
            <component :is="commands[name].icon.is" class="h-4 w-auto min-w-4" v-bind="iconProps" />
        </span>
        <component :is="commands[name].icon.is" v-else class="size-4" v-bind="iconProps" />
        <template v-if="showLabel">
            <span class="ml-2 flex-grow text-left text-sm">{{ title }}</span>
            <span
                v-if="shortcut"
                class="ml-4"
                :class="[
                    isPunctuationShortcut(shortcut)
                        ? 'text-sm font-bold leading-4'
                        : 'text-xs text-fg/80',
                    { 'forced-colors:text-[HighlightText]': pressed },
                ]"
                >{{ shortcut }}</span
            >
        </template>
    </button>
</template>
