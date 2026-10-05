<script setup lang="ts">
import type { JudgmentLineStyle } from '../../chart/events/stage/style'
import { i18n } from '../../i18n'
import ChoiceField from './ChoiceField.vue'

const modelValue = defineModel<JudgmentLineStyle | undefined>({ required: true })
</script>

<template>
    <ChoiceField
        v-model="modelValue"
        :label="i18n.modals.form.judgmentLineStyle.label"
        :options="[
            [i18n.modals.form.judgmentLineStyle.default, 'default'],
            [i18n.modals.form.judgmentLineStyle.singleLine, 'singleLine'],
        ]"
        variant="optional"
    />
</template>
