<script setup lang="ts">
import { useTemplateRef, type Ref } from 'vue'
import BaseField from './BaseField.vue'
import { i18n } from '../../i18n'
import { useEmptyLabel } from './emptyLabel'

defineProps<{
    label: string
    min?: number
    max?: number
    step?: number | 'any'
}>()

const emptyLabel = useEmptyLabel()

const input: Ref<HTMLInputElement | null> = useTemplateRef('input')

const modelValue = defineModel<number | undefined>({
    required: true,
    set: (value) =>
        input.value?.reportValidity()
            ? typeof value === 'number'
                ? value
                : undefined
            : modelValue.value,
})

const onFocus = (event: FocusEvent) => {
    ;(event.currentTarget as HTMLInputElement | null)?.select()
}
</script>

<template>
    <BaseField :label>
        <input
            ref="input"
            v-model.lazy="modelValue"
            class="w-full appearance-none rounded-full bg-button px-4 py-1 shadow-md transition-colors placeholder:text-fg/80 hover:shadow-accent focus:outline-none focus:ring-2 focus:ring-fg active:bg-accent active:text-on-accent"
            :placeholder="emptyLabel?.() ?? i18n.modals.form.notSet"
            type="number"
            :min
            :max
            :step
            @focus="onFocus"
        />
    </BaseField>
</template>
