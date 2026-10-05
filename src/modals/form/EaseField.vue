<script setup lang="ts" generic="E extends Ease">
import { computed } from 'vue'
import {
    composeEase,
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
        <MultiSelectField
            v-model="mode"
            :label="modeLabel"
            :options="modeOptions"
            :disabled="isLinear"
            :empty-label="isLinear ? '—' : undefined"
        />
    </template>
</template>
