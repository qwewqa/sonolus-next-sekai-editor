<script setup lang="ts" generic="const T">
import ChevronIcon from '../../editor/workspace/ChevronIcon.vue'
import BaseField from './BaseField.vue'

defineProps<{
    label: string
    options: (readonly [string, NoInfer<T>])[]
}>()

const modelValue = defineModel<T>({ required: true })
</script>

<template>
    <BaseField :label>
        <div class="form-field-select group">
            <select
                v-model.lazy="modelValue"
                class="w-full appearance-none rounded-full bg-button px-4 py-1 shadow-md transition-colors hover:shadow-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-fg active:bg-accent active:text-on-accent"
                required
            >
                <option v-for="([name, value], index) in options" :key="index" :value>
                    {{ name }}
                </option>
            </select>
            <span class="form-field-select-icon group-active:text-on-accent" aria-hidden="true">
                <ChevronIcon direction="down" />
            </span>
        </div>
    </BaseField>
</template>
