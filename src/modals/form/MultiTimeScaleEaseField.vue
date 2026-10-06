<script setup lang="ts">
import type { TimeScaleEase } from '../../chart/timeScale'
import { timeScaleEaseFamilies, type EaseEdit } from '../../ease'
import { i18n } from '../../i18n'
import EaseField from './EaseField.vue'

const modelValue = defineModel<EaseEdit<TimeScaleEase> | undefined>({ required: true })
</script>

<template>
    <EaseField
        v-model="modelValue"
        :label="i18n.modals.form.timeScaleEase.label"
        :mode-label="i18n.modals.form.timeScaleEase.mode"
        :families="timeScaleEaseFamilies"
    />
</template>
