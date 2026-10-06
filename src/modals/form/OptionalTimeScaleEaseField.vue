<script setup lang="ts">
import type { TimeScaleEase } from '../../chart/timeScale'
import { timeScaleEaseFunctionNames, type EaseEdit } from '../../ease'
import { i18n } from '../../i18n'
import EaseField from './EaseField.vue'

const modelValue = defineModel<EaseEdit<TimeScaleEase> | undefined>({ required: true })
</script>

<template>
    <EaseField
        v-model="modelValue"
        :type-label="i18n.modals.form.timeScaleEase.type"
        :function-label="i18n.modals.form.timeScaleEase.function"
        :functions="timeScaleEaseFunctionNames"
        optional
    />
</template>
