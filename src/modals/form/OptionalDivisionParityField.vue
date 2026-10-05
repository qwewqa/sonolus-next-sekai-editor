<script setup lang="ts">
import type { DivisionParity } from '../../chart/events/stage/pivot'
import { i18n } from '../../i18n'
import ChoiceField from './ChoiceField.vue'

const modelValue = defineModel<DivisionParity | undefined>({ required: true })
</script>

<template>
    <ChoiceField
        v-model="modelValue"
        :label="i18n.modals.form.divisionParity.label"
        :options="[
            [i18n.modals.form.divisionParity.even, 'even'],
            [i18n.modals.form.divisionParity.odd, 'odd'],
        ]"
        variant="optional"
    />
</template>
