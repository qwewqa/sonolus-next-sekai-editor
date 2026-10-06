<script setup lang="ts">
import { commands, type CommandName } from '../commands'

defineProps<{
    title: string
    /** The toolbar command this section explains, shown by its icon. */
    command?: CommandName
}>()
</script>

<template>
    <section>
        <h2 class="flex items-center gap-2 font-bold">
            <!-- Flat, unlike the raised toolbar button, so it does not read as clickable.
            An icon column, so text glyphs fit and the titles line up. -->
            <span
                v-if="command"
                class="flex size-7 shrink-0 items-center justify-center rounded-full bg-button font-normal"
                aria-hidden="true"
                data-icon-column
            >
                <component
                    :is="commands[command].icon.is"
                    class="h-4 w-auto min-w-4 fill-current"
                    v-bind="commands[command].icon.props"
                />
            </span>
            {{ title }}
        </h2>

        <ul class="mt-2 list-outside list-disc pl-5">
            <slot />
        </ul>
    </section>
</template>
