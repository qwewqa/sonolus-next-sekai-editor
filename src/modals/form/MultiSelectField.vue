<script setup lang="ts" generic="const T">
import { i18n } from '../../i18n'
import ChevronIcon from '../../editor/workspace/ChevronIcon.vue'
import BaseField from './BaseField.vue'

defineProps<{
    label: string
    options: [string, NoInfer<T>][]
}>()

// eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
const modelValue = defineModel<T | undefined>({ required: true })
</script>

<template>
    <BaseField :label>
        <div class="form-field-select group">
            <select
                v-model.lazy="modelValue"
                :class="{ 'text-fg/80': modelValue === undefined }"
                class="w-full appearance-none rounded-full bg-button px-4 py-1 shadow-md transition-colors hover:shadow-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-fg active:bg-accent active:text-on-accent"
            >
                <!-- Selected objects disagree; this option is never committed. -->
                <option :value="undefined" disabled>{{ i18n.modals.form.mixed }}</option>
                <option
                    v-for="([name, value], index) in options"
                    :key="index"
                    class="text-fg"
                    :value
                >
                    {{ name }}
                </option>
            </select>
            <span class="form-field-select-icon group-active:text-on-accent" aria-hidden="true">
                <ChevronIcon direction="down" />
            </span>
        </div>
    </BaseField>
</template>
