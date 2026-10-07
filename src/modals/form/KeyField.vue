<script setup lang="ts">
import { computed, provide, ref, useId } from 'vue'
import { i18n } from '../../i18n'
import {
    bindingOf,
    formatShortcut,
    formatBinding,
    isAltGraphAlphanumeric,
    isApplePlatform,
    isPunctuationShortcut,
    isReservedChord,
} from '../../editor/controls/bindings'
import { isComposingKey } from '../../utils/composition'
import { interpolateRaw } from '../../utils/interpolate'
import BaseField from './BaseField.vue'
import { stackLongValuesKey } from './fieldLayout'

const props = defineProps<{
    label: string
    notes?: string[]
}>()

const modelValue = defineModel<string | undefined>({ required: true })

// The button stays under the pointer through capture; long text wraps in place.
provide(stackLongValuesKey, false)

const isActive = ref(false)
// The name reads the binding or prompt after the label.
const valueId = useId()
// A capture the keyboard started ends on Escape; a click's records it, so Escape stays bindable.
const fromKeyboard = ref(false)
// The chord last refused during this capture, as shown, and why.
const refused = ref<string>()
const refusedAs = ref<'reserved' | 'altGraph'>('reserved')

const refusal = computed(() =>
    refused.value === undefined
        ? undefined
        : interpolateRaw(i18n.value.modals.form.key[refusedAs.value], refused.value),
)
// A refusal reads in full under the row, like the other notes, not cut off in the button.
const notes = computed(() =>
    refusal.value === undefined ? props.notes : [...(props.notes ?? []), refusal.value],
)

const onClick = (event: MouseEvent) => {
    if (isActive.value) modelValue.value = undefined
    isActive.value = !isActive.value
    fromKeyboard.value = event.detail === 0
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

const hasModifier = (event: KeyboardEvent) =>
    event.ctrlKey || event.metaKey || event.altKey || event.shiftKey

const onKeyDown = (event: KeyboardEvent) => {
    // Delete and Backspace clear, as a second click does; a capture records them.
    if (!isActive.value) {
        if (['Delete', 'Backspace'].includes(event.key) && !hasModifier(event)) {
            event.preventDefault()
            modelValue.value = undefined
        }
        return
    }
    if (event.key === 'Tab' || modifierKeys.has(event.key) || isPartialKey(event)) return

    event.preventDefault()
    event.stopPropagation()

    if (event.key === 'Escape' && fromKeyboard.value && !hasModifier(event)) {
        isActive.value = false
        refused.value = undefined
        return
    }

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
    refused.value = undefined
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
        <template #default="{ textId }">
            <!-- Unassigned is italic so bound keys stand out, also in forced colours. -->
            <button
                class="key-field-button w-full rounded-2xl bg-button px-4 py-1 text-left shadow-md outline-none transition-colors hover:shadow-accent focus-visible:ring-2 focus-visible:ring-fg active:bg-accent active:text-on-accent"
                :class="{
                    'animate-pulse': isActive,
                    'italic text-fg/80': !isActive && !formatShortcut(modelValue),
                }"
                type="button"
                :title="isActive ? i18n.modals.form.key.clear : i18n.modals.form.key.input"
                :aria-labelledby="`${textId} ${valueId}`"
                @mousedown="onMouseDown"
                @click="onClick"
                @keydown="onKeyDown"
                @blur="onBlur"
            >
                <!-- One punctuation mark reads larger and bold, as in the toolbar. -->
                <span
                    :id="valueId"
                    :class="{
                        'text-lg font-bold leading-none':
                            !isActive && isPunctuationShortcut(formatShortcut(modelValue) ?? ''),
                    }"
                    >{{
                        isActive
                            ? fromKeyboard
                                ? i18n.modals.form.key.pressCancel
                                : i18n.modals.form.key.press
                            : (formatShortcut(modelValue) ?? i18n.modals.form.key.unassigned)
                    }}</span
                >
            </button>
            <span class="sr-only" role="status">{{ refusal }}</span>
        </template>
    </BaseField>
</template>

<style scoped>
/* One line rounds fully at 2xl; wrapped lines round as a card. */
.key-field-button {
    white-space: normal;
    overflow-wrap: anywhere;
}
</style>
