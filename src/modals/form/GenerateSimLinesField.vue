<script setup lang="ts">
import type { GenerateSimLines } from '../../chart/stages.ts'
import { i18n } from '../../i18n'
import ChoiceField from './ChoiceField.vue'

const modelValue = defineModel<GenerateSimLines>({ required: true })
</script>

<template>
    <ChoiceField
        v-model="modelValue"
        :label="i18n.modals.form.generateSimLines.label"
        :options="[
            [i18n.modals.form.generateSimLines.global, 'global'],
            [i18n.modals.form.generateSimLines.isolated, 'isolated'],
        ]"
    />
</template>
