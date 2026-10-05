<script setup lang="ts">
import type { ConnectorPresentation } from '../../chart/note'
import { i18n } from '../../i18n'
import ChoiceField from './ChoiceField.vue'

const modelValue = defineModel<ConnectorPresentation | undefined>({ required: true })
</script>

<template>
    <ChoiceField
        v-model="modelValue"
        :label="i18n.modals.form.connectorPresentation.label"
        :options="[
            [i18n.modals.form.connectorPresentation.default, 'default'],
            [i18n.modals.form.connectorPresentation.fullscreen, 'fullscreen'],
        ]"
        variant="optional"
    />
</template>
