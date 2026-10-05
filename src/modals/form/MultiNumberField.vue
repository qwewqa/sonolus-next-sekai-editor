<script setup lang="ts">
import {
    computed,
    inject,
    nextTick,
    onBeforeUnmount,
    ref,
    useTemplateRef,
    watch,
    type Ref,
} from 'vue'
import { i18n } from '../../i18n'
import BaseField from './BaseField.vue'
import { mixedRange, useFieldUsage } from './fieldUsage'
import { numberEditKey } from './numberEdit'

defineProps<{
    label: string
    min?: number
    max?: number
    step?: number | 'any'
}>()

const input: Ref<HTMLInputElement | null> = useTemplateRef('input')

const modelValue = defineModel<number | undefined>({ required: true })
const field = useFieldUsage()
// A mixed number shows the range in use rather than just "Mixed".
const range = computed(() => mixedRange(field?.value))
const edit = inject(numberEditKey, undefined)
const owner = Symbol('number field')
const text = ref(`${modelValue.value ?? ''}`)
let dirty = false

const reset = () => {
    dirty = false
    text.value = `${modelValue.value ?? ''}`
    if (input.value) input.value.value = text.value
}

watch(modelValue, () => {
    if (!dirty) reset()
})
if (edit) watch(edit.revision, reset)
onBeforeUnmount(() => edit?.cancel(owner))

const isValid = () => input.value?.validity.valid && Number.isFinite(input.value.valueAsNumber)

const onInput = () => {
    if (!input.value) return
    // Number inputs expose an empty value for intermediate text such as "-"
    // or "1e". Writing that empty value back would erase the user's typing.
    if (!input.value.validity.badInput) text.value = input.value.value
    dirty = true
    if (!edit) return
    if (isValid()) {
        const value = input.value.valueAsNumber
        edit.preview(owner, () => (modelValue.value = value))
    } else {
        edit.invalidate(owner)
    }
}

const onChange = async () => {
    if (!dirty) return
    if (isValid() && input.value) {
        if (edit) {
            edit.commit(owner)
        } else {
            modelValue.value = input.value.valueAsNumber
        }
    } else {
        edit?.cancel(owner)
    }
    dirty = false
    await nextTick()
    reset()
}

const cancel = async () => {
    edit?.cancel(owner)
    dirty = false
    await nextTick()
    reset()
}

const onFocus = (event: FocusEvent) => {
    ;(event.currentTarget as HTMLInputElement | null)?.select()
}
</script>

<template>
    <BaseField :label :mixed="[]">
        <input
            ref="input"
            :value="text"
            :placeholder="modelValue === undefined ? (range ?? i18n.modals.form.mixed) : undefined"
            :title="
                modelValue === undefined && range
                    ? `${i18n.modals.form.mixed}: ${range}`
                    : undefined
            "
            class="w-full appearance-none rounded-full bg-button px-4 py-1 shadow-md transition-colors placeholder:text-fg/80 hover:shadow-accent focus:outline-none focus:ring-2 focus:ring-fg active:bg-accent active:text-on-accent"
            type="number"
            :min
            :max
            :step
            required
            @focus="onFocus"
            @input="onInput"
            @change="onChange"
            @blur="onChange"
            @keydown.esc.stop.prevent="cancel"
        />
    </BaseField>
</template>
