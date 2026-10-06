<script setup lang="ts" generic="E extends Ease">
import { computed, provide } from 'vue'
import {
    composeEase,
    easeFamily,
    easeEditParts,
    easeModes,
    setEaseEditFamily,
    setEaseEditMode,
    type Ease,
    type EaseEdit,
    type EaseFamily,
    type EaseFamilyOf,
    type EaseMode,
} from '../../ease'
import { i18n } from '../../i18n'
import FieldUsageProvider from '../../editor/workspace/properties/FieldUsageProvider.vue'
import { unsetChoiceKey } from './emptyLabel'
import { useFieldUsage, type FieldUsage } from './fieldUsage'
import EaseIcon from './EaseIcon.vue'
import MultiSelectField from './MultiSelectField.vue'
import OptionalSelectField from './OptionalSelectField.vue'

const props = defineProps<{
    label: string
    modeLabel: string
    families: readonly EaseFamilyOf<E>[]
    /** Each half can be left unset instead of showing mixed values. */
    optional?: boolean
}>()

const modelValue = defineModel<EaseEdit | undefined>({ required: true })

// Either half may stay unset while the other is set.
if (props.optional) provide(unsetChoiceKey, true)

const family = computed({
    get: () => easeEditParts(modelValue.value).family,
    set: (value) => (modelValue.value = setEaseEditFamily(modelValue.value, value)),
})

const mode = computed({
    get: () => easeEditParts(modelValue.value).mode,
    set: (value) => (modelValue.value = setEaseEditMode(modelValue.value, value)),
})

const familyOptions = computed(() =>
    props.families.map((value): [string, EaseFamilyOf<E>] => [
        i18n.value.modals.form.ease[value as EaseFamily],
        value,
    ]),
)

const modeOptions = computed(() =>
    easeModes.map((value): [string, EaseMode] => [i18n.value.modals.form.ease[value], value]),
)

// Linear has no mode.
const isLinear = computed(() => family.value === 'linear')

// The mode covers only curves; linear objects are listed apart, and narrow.
const field = useFieldUsage()
const modeUsage = computed((): FieldUsage => {
    const own = field?.value
    const usage = own?.usage
    if (!own || !usage) return { usage: undefined }
    const values = new Map<unknown, number>()
    let linear = 0
    for (const [value, count] of usage.values) {
        if (easeFamily(value as Ease) === 'linear') linear += count
        else values.set(value, count)
    }
    if (!linear) return own
    if (!values.size) return { usage: undefined }
    return {
        ...own,
        usage: { values, covered: usage.covered - linear, total: usage.total },
        extra: [
            {
                label: i18n.value.modals.form.ease.linear,
                count: linear,
                narrow: () => own.narrow?.((value) => easeFamily(value as Ease) === 'linear'),
            },
        ],
    }
})

// Only a complete ease has a curve to show.
const curve = computed(() =>
    family.value && (mode.value || isLinear.value)
        ? composeEase(family.value, mode.value ?? 'in')
        : undefined,
)
</script>

<template>
    <template v-if="optional">
        <OptionalSelectField v-model="family" :label :options="familyOptions">
            <template v-if="curve" #leading><EaseIcon :ease="curve" /></template>
        </OptionalSelectField>
        <OptionalSelectField
            v-model="mode"
            :label="modeLabel"
            :options="modeOptions"
            :disabled="isLinear"
        />
    </template>
    <template v-else>
        <MultiSelectField v-model="family" :label :options="familyOptions">
            <template v-if="curve" #leading><EaseIcon :ease="curve" /></template>
        </MultiSelectField>
        <FieldUsageProvider :usage="modeUsage">
            <MultiSelectField
                v-model="mode"
                :label="modeLabel"
                :options="modeOptions"
                :disabled="isLinear"
                :empty-label="isLinear ? '—' : undefined"
            />
        </FieldUsageProvider>
    </template>
</template>
