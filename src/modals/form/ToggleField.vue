<script setup lang="ts">
import { computed } from 'vue'
import { i18n } from '../../i18n'
import BaseField from './BaseField.vue'
import ToggleSwitch from './ToggleSwitch.vue'

defineProps<{
    label: string
}>()

const modelValue = defineModel<boolean>({ required: true })
// The shown value, also on hover where it truncates.
const shown = computed(() =>
    modelValue.value
        ? i18n.value.modals.form.toggle.enabled
        : i18n.value.modals.form.toggle.disabled,
)
</script>

<template>
    <BaseField :label>
        <div class="form-field-toggle group">
            <input
                class="w-full rounded-full bg-button px-4 py-1 text-left shadow-md outline-none transition-colors hover:shadow-accent focus-visible:ring-2 focus-visible:ring-fg active:bg-accent active:text-on-accent"
                type="button"
                :value="shown"
                :title="shown"
                @click="modelValue = !modelValue"
            />
            <ToggleSwitch :value="modelValue" />
        </div>
    </BaseField>
</template>
