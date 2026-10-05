<script setup lang="ts">
import type { TimeScaleTransition } from '../../chart/timeScale.ts'
import { i18n } from '../../i18n'
import { useQualifiedLabels } from './qualifiedLabels'
import ChoiceField from './ChoiceField.vue'
import TimeScaleTransitionIcon from './TimeScaleTransitionIcon.vue'

const modelValue = defineModel<TimeScaleTransition | undefined>({ required: true })

const qualified = useQualifiedLabels()
</script>

<template>
    <ChoiceField
        v-model="modelValue"
        :label="
            qualified
                ? i18n.modals.form.timeScaleTransition.qualified
                : i18n.modals.form.timeScaleTransition.label
        "
        :options="[
            [i18n.modals.form.timeScaleTransition.timeScale, 'timeScale'],
            [i18n.modals.form.timeScaleTransition.scroll, 'scroll'],
        ]"
        variant="multi"
    >
        <template #glyph="{ value }"><TimeScaleTransitionIcon :transition="value" /></template>
    </ChoiceField>
</template>
