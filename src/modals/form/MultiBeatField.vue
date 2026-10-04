<script setup lang="ts">
import { computed } from 'vue'
import { fromDisplayedBeat, toDisplayedBeat } from '../../editor/beatDisplay'
import { i18n } from '../../i18n'
import MultiNumberField from './MultiNumberField.vue'

const modelValue = defineModel<number | undefined>({ required: true })
const displayedBeat = computed({
    get: () => (modelValue.value === undefined ? undefined : toDisplayedBeat(modelValue.value)),
    set: (value: number | undefined) => {
        modelValue.value = value === undefined ? undefined : fromDisplayedBeat(value)
    },
})
</script>

<template>
    <MultiNumberField
        v-model="displayedBeat"
        :label="i18n.modals.form.beat.label"
        :min="1"
        step="any"
    />
</template>
