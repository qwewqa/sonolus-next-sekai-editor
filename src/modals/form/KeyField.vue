<script setup lang="ts">
import { ref } from 'vue'
import { i18n } from '../../i18n'
import { formatShortcut } from '../../utils/format'
import BaseField from './BaseField.vue'

defineProps<{
    label: string
}>()

const modelValue = defineModel<string | undefined>({ required: true })

const isActive = ref(false)

const onClick = (event: MouseEvent) => {
    if (isActive.value) modelValue.value = undefined
    isActive.value = !isActive.value
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

const onKeyDown = (event: KeyboardEvent) => {
    if (!isActive.value) return
    if (event.key === 'Tab' || modifierKeys.has(event.key)) return

    event.preventDefault()
    event.stopPropagation()

    modelValue.value = event.key
    isActive.value = false
}

const onBlur = () => {
    isActive.value = false
}
</script>

<template>
    <BaseField :label>
        <template v-if="$slots.icon" #icon>
            <span class="form-field-icon" aria-hidden="true"><slot name="icon" /></span>
        </template>
        <button
            class="w-full rounded-full bg-button px-4 py-1 text-left shadow-md transition-colors hover:shadow-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-fg active:bg-accent active:text-on-accent"
            :class="{
                'animate-pulse': isActive,
                'text-fg/50': !isActive && !formatShortcut(modelValue),
            }"
            type="button"
            :title="isActive ? i18n.modals.form.key.clear : i18n.modals.form.key.input"
            @mousedown="onMouseDown"
            @click="onClick"
            @keydown="onKeyDown"
            @blur="onBlur"
        >
            {{
                isActive
                    ? i18n.modals.form.key.press
                    : (formatShortcut(modelValue) ?? i18n.modals.form.key.unassigned)
            }}
        </button>
    </BaseField>
</template>
