<script setup lang="ts">
import type { TimeScaleEase } from '../../chart/timeScale'
import { timeScaleEaseFamilies, type EaseEdit } from '../../ease'
import { i18n } from '../../i18n'
import { useQualifiedLabels } from './qualifiedLabels'
import EaseField from './EaseField.vue'

const modelValue = defineModel<EaseEdit<TimeScaleEase> | undefined>({ required: true })

const qualified = useQualifiedLabels()
</script>

<template>
    <EaseField
        v-model="modelValue"
        :label="
            qualified
                ? i18n.modals.form.timeScaleEase.qualified
                : i18n.modals.form.timeScaleEase.label
        "
        :mode-label="
            qualified
                ? i18n.modals.form.timeScaleEase.qualifiedMode
                : i18n.modals.form.timeScaleEase.mode
        "
        :families="timeScaleEaseFamilies"
    />
</template>
