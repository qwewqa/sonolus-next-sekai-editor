<script setup lang="ts" generic="E extends Ease">
import { computed, provide } from 'vue'
import {
    composeEase,
    easeEditParts,
    easeFunctionOf,
    easeTypeOf,
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
import { useFieldUsage, type FieldUsage, type MixedValue } from './fieldUsage'
import EaseIcon from './EaseIcon.vue'
import MultiSelectField from './MultiSelectField.vue'
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

// The function covers only modes; None and Linear objects are listed apart, and narrow.
const functionUsage = computed((): FieldUsage => {
    const own = field?.value
    const usage = own?.usage
    if (!own || !usage) return { usage: undefined }
    const values = new Map<unknown, number>()
    const apart = new Map<EaseType, number>()
    for (const [value, count] of usage.values) {
        if (easeFunctionOf(value as Ease)) values.set(value, count)
        else
            apart.set(
                easeTypeOf(value as Ease),
                (apart.get(easeTypeOf(value as Ease)) ?? 0) + count,
            )
    }
    if (!apart.size) return own
    if (!values.size) return { usage: undefined }
    const covered = [...apart.values()].reduce((sum, count) => sum + count, 0)
    return {
        ...own,
        usage: { values, covered: usage.covered - covered, total: usage.total },
        extra: easeTypes.flatMap((standaloneType): MixedValue[] => {
            const count = apart.get(standaloneType)
            return count
                ? [
                      {
                          label: i18n.value.modals.form.ease[standaloneType],
                          count,
                          narrow: () =>
                              own.narrow?.((value) => easeTypeOf(value as Ease) === standaloneType),
                      },
                  ]
                : []
        }),
    }
})

// Only a complete ease has a curve to show.
const curve = computed(() =>
    type.value && (name.value || standalone.value)
        ? composeEase(type.value, name.value)
        : undefined,
)
</script>

<template>
    <template v-if="optional">
        <OptionalSelectField v-model="type" :label="typeLabel" :options="typeOptions">
            <template v-if="curve" #leading><EaseIcon :ease="curve" /></template>
        </OptionalSelectField>
        <OptionalSelectField
            v-model="name"
            :label="functionLabel"
            :options="functionOptions"
            :disabled="standalone"
        />
    </template>
    <template v-else>
        <MultiSelectField v-model="type" :label="typeLabel" :options="typeOptions">
            <template v-if="curve" #leading><EaseIcon :ease="curve" /></template>
        </MultiSelectField>
        <FieldUsageProvider :usage="functionUsage">
            <MultiSelectField
                v-model="name"
                :label="functionLabel"
                :options="functionOptions"
                :disabled="standalone"
                :empty-label="standalone ? '—' : undefined"
            />
        </FieldUsageProvider>
    </template>
</template>
