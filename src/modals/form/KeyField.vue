<script setup lang="ts">
import { computed, ref } from 'vue'
import { i18n } from '../../i18n'
import {
    bindingOf,
    formatShortcut,
    formatBinding,
    isAltGraphAlphanumeric,
    isApplePlatform,
    isReservedChord,
} from '../../editor/controls/bindings'
import { isComposingKey } from '../../utils/composition'
import { interpolateRaw } from '../../utils/interpolate'
import BaseField from './BaseField.vue'

defineProps<{
    label: string
    notes?: string[]
}>()

const modelValue = defineModel<string | undefined>({ required: true })

const isActive = ref(false)
// The chord last refused during this capture, as shown, and why.
const refused = ref<string>()
const refusedAs = ref<'reserved' | 'altGraph'>('reserved')

const prompt = computed(() =>
    refused.value === undefined
        ? i18n.value.modals.form.key.press
        : interpolateRaw(i18n.value.modals.form.key[refusedAs.value], refused.value),
)

const onClick = (event: MouseEvent) => {
    if (isActive.value) modelValue.value = undefined
    isActive.value = !isActive.value
    refused.value = undefined
    // Safari doesn't focus clicked buttons, so keys would never reach this one.
    if (isActive.value) (event.currentTarget as HTMLElement).focus()
}

// Safari moves focus off a pressed button, which would end capture before the click.
const onMouseDown = (event: MouseEvent) => {
    if (isActive.value) event.preventDefault()
}

// Modifiers alone are never bindings; capture waits for the key they modify.
const modifierKeys = new Set([
    'Alt',
    'AltGraph',
    'CapsLock',
    'Control',
    'Fn',
    'FnLock',
    'Hyper',
    'Meta',
    'NumLock',
    'OS',
    'ScrollLock',
    'Shift',
    'Super',
    'Symbol',
    'SymbolLock',
])

// IME and dead keys only start a character; capture waits for a real key.
const isPartialKey = (event: KeyboardEvent) =>
    isComposingKey(event) || ['Process', 'Dead', 'Unidentified'].includes(event.key)

const onKeyDown = (event: KeyboardEvent) => {
    if (!isActive.value) return
    if (event.key === 'Tab' || modifierKeys.has(event.key) || isPartialKey(event)) return

    event.preventDefault()
    event.stopPropagation()

    const apple = isApplePlatform()
    const binding = bindingOf(event, apple)
    // Pages never receive these on a real keyboard; capture waits for another key.
    if (isReservedChord(event, apple)) {
        refused.value = formatShortcut(binding)
        refusedAs.value = 'reserved'
        return
    }
    // Recorded, it would be the bare key; say so rather than store that.
    if (isAltGraphAlphanumeric(event, apple)) {
        refused.value = formatBinding(`Mod+Alt+${event.key.toLowerCase()}`, apple)
        refusedAs.value = 'altGraph'
        return
    }
    modelValue.value = binding
    isActive.value = false
}

const onBlur = () => {
    isActive.value = false
    refused.value = undefined
}
</script>

<template>
    <BaseField :label :notes>
        <template v-if="$slots.icon" #icon>
            <span class="form-field-icon" aria-hidden="true" data-icon-column
                ><slot name="icon"
            /></span>
        </template>
        <button
            class="w-full rounded-full bg-button px-4 py-1 text-left shadow-md transition-colors hover:shadow-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-fg active:bg-accent active:text-on-accent"
            :class="{
                'animate-pulse': isActive,
                'text-fg/50': !isActive && !formatShortcut(modelValue),
            }"
            type="button"
            :title="
                isActive
                    ? refused === undefined
                        ? i18n.modals.form.key.clear
                        : prompt
                    : i18n.modals.form.key.input
            "
            @mousedown="onMouseDown"
            @click="onClick"
            @keydown="onKeyDown"
            @blur="onBlur"
        >
            {{
                isActive ? prompt : (formatShortcut(modelValue) ?? i18n.modals.form.key.unassigned)
            }}
        </button>
    </BaseField>
</template>
