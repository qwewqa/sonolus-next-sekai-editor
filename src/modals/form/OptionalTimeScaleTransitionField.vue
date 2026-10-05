<script setup lang="ts">
import type { TimeScaleTransition } from '../../chart/timeScale.ts'
import { i18n } from '../../i18n'
import ChoiceField from './ChoiceField.vue'

const modelValue = defineModel<TimeScaleTransition | undefined>({ required: true })
</script>

<template>
    <ChoiceField
        v-model="modelValue"
        :label="i18n.modals.form.timeScaleTransition.label"
        :options="[
            [i18n.modals.form.timeScaleTransition.timeScale, 'timeScale'],
            [i18n.modals.form.timeScaleTransition.scroll, 'scroll'],
        ]"
        variant="optional"
    />
</template>
