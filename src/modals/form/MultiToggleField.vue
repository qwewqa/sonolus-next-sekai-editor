<script setup lang="ts">
import { i18n } from '../../i18n'
import BaseField from './BaseField.vue'
import ToggleSwitch from './ToggleSwitch.vue'

defineProps<{
    label: string
    disabled?: string
    enabled?: string
}>()

const modelValue = defineModel<boolean | undefined>({ required: true })
</script>

<template>
    <BaseField :label>
        <div class="form-field-toggle group">
            <input
                class="w-full rounded-full bg-button px-4 py-1 text-left shadow-md transition-colors hover:shadow-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-fg active:bg-accent active:text-on-accent"
                type="button"
                :class="{ 'text-fg/80': modelValue === undefined }"
                :value="
                    modelValue === undefined
                        ? i18n.modals.form.mixed
                        : modelValue
                          ? (enabled ?? i18n.modals.form.toggle.enabled)
                          : (disabled ?? i18n.modals.form.toggle.disabled)
                "
                @click="modelValue = !modelValue"
            />
            <ToggleSwitch :value="modelValue" />
        </div>
    </BaseField>
</template>
