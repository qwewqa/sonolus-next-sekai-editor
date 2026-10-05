<script setup lang="ts">
import { easeFamilies, type EaseEdit } from '../../ease'
import { i18n } from '../../i18n'
import EaseField from './EaseField.vue'

const modelValue = defineModel<EaseEdit | undefined>({ required: true })
</script>

<template>
    <EaseField
        v-model="modelValue"
        :label="i18n.modals.form.connectorEase.label"
        :mode-label="i18n.modals.form.connectorEase.mode"
        :families="easeFamilies"
    />
</template>
