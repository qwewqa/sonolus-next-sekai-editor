<script setup lang="ts" generic="E extends Ease">
import { computed, h, provide } from 'vue'
import {
    composeEase,
    easeEditParts,
    easeFunctionOf,
    easeTypes,
    setEaseEditFunction,
    setEaseEditType,
    type Ease,
    type EaseEdit,
    type EaseFunctionName,
    type EaseFunctionOf,
    type EaseType,
} from '../../ease'
import { i18n } from '../../i18n'
import FieldUsageProvider from '../../editor/workspace/properties/FieldUsageProvider.vue'
import { unsetChoiceKey } from './emptyLabel'
import { useFieldUsage, type FieldUsage } from './fieldUsage'
import EaseIcon from './EaseIcon.vue'
import MultiSelectField from './MultiSelectField.vue'
import type { OptionGlyph } from './optionGlyph'
import OptionalSelectField from './OptionalSelectField.vue'

const props = defineProps<{
    typeLabel: string
    functionLabel: string
    functions: readonly EaseFunctionOf<E>[]
    /** Each half can be left unset instead of showing mixed values. */
    optional?: boolean
}>()

const modelValue = defineModel<EaseEdit | undefined>({ required: true })

// Either half may stay unset while the other is set.
if (props.optional) provide(unsetChoiceKey, true)

const type = computed({
    get: () => easeEditParts(modelValue.value).type,
    set: (value) => (modelValue.value = setEaseEditType(modelValue.value, value)),
})

const name = computed({
    get: () => easeEditParts(modelValue.value).name,
    set: (value) => (modelValue.value = setEaseEditFunction(modelValue.value, value)),
})

const typeOptions = computed(() =>
    easeTypes.map((value): [string, EaseType] => [i18n.value.modals.form.ease[value], value]),
)

const functionOptions = computed(() =>
    props.functions.map((value): [string, EaseFunctionOf<E>] => [
        i18n.value.modals.form.ease[value as EaseFunctionName],
        value,
    ]),
)

const field = useFieldUsage()

// None and Linear have no function, including when every selected object is one of them.
const standalone = computed(() => {
    if (type.value) return type.value === 'none' || type.value === 'linear'
    const usage = field?.value?.usage
    return (
        !!usage?.values.size &&
        [...usage.values.keys()].every((value) => !easeFunctionOf(value as Ease))
    )
})

// The function applies only to modes; None and Linear objects count as it not applying.
const functionUsage = computed((): FieldUsage => {
    const own = field?.value
    const usage = own?.usage
    if (!own || !usage) return { usage: undefined }
    const values = new Map<unknown, number>()
    let standaloneCount = 0
    for (const [value, count] of usage.values) {
        if (easeFunctionOf(value as Ease)) values.set(value, count)
        else standaloneCount += count
    }
    if (!standaloneCount) return own
    if (!values.size) return { usage: undefined }
    return {
        ...own,
        usage: { values, covered: usage.covered - standaloneCount, total: usage.total },
        narrow: (predicate) =>
            own.narrow?.((value) => !!easeFunctionOf(value as Ease) && predicate(value)),
    }
})

// A list shows the curve each pick would give, and none while a pick's is unknown,
// as a mode's while functions are mixed.
const typeGlyph: OptionGlyph<EaseType> = (value) => {
    // From None or Linear, a mode takes Quad.
    const next = type.value === 'none' || type.value === 'linear' ? 'quad' : name.value
    if (value !== 'none' && value !== 'linear' && !next) return
    return h(EaseIcon, { ease: composeEase(value, next) })
}
const functionGlyph: OptionGlyph<EaseFunctionName> = (value) =>
    type.value && type.value !== 'none' && type.value !== 'linear'
        ? h(EaseIcon, { ease: composeEase(type.value, value) })
        : undefined

// Only a complete ease has a curve to show.
const curve = computed(() =>
    type.value && (name.value || standalone.value)
        ? composeEase(type.value, name.value)
        : undefined,
)
</script>

<template>
    <template v-if="optional">
        <OptionalSelectField
            v-model="type"
            :label="typeLabel"
            :options="typeOptions"
            :option-glyph="typeGlyph"
        >
            <template v-if="curve" #leading><EaseIcon :ease="curve" /></template>
        </OptionalSelectField>
        <OptionalSelectField
            v-model="name"
            :label="functionLabel"
            :options="functionOptions"
            :disabled="standalone"
            :option-glyph="functionGlyph"
        />
    </template>
    <template v-else>
        <MultiSelectField
            v-model="type"
            :label="typeLabel"
            :options="typeOptions"
            :option-glyph="typeGlyph"
        >
            <template v-if="curve" #leading><EaseIcon :ease="curve" /></template>
        </MultiSelectField>
        <FieldUsageProvider :usage="functionUsage">
            <MultiSelectField
                v-model="name"
                :label="functionLabel"
                :options="functionOptions"
                :disabled="standalone"
                :empty-label="standalone ? '—' : undefined"
                :option-glyph="functionGlyph"
            />
        </FieldUsageProvider>
    </template>
</template>
