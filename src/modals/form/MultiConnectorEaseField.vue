<script setup lang="ts">
import { easeFunctionNames, type EaseEdit } from '../../ease'
import { i18n } from '../../i18n'
import EaseField from './EaseField.vue'

const modelValue = defineModel<EaseEdit | undefined>({ required: true })
</script>

<template>
    <EaseField
        v-model="modelValue"
        :type-label="i18n.modals.form.connectorEase.type"
        :function-label="i18n.modals.form.connectorEase.function"
        :functions="easeFunctionNames"
    />
</template>
