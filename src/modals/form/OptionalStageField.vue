<script setup lang="ts">
import type { StageId } from '../../chart/stages'
import { stages } from '../../history/stages'
import { i18n } from '../../i18n'
import OptionalSelectField from './OptionalSelectField.vue'

defineProps<{
    /** Text for no stage, e.g. when it means every stage rather than 'unchanged'. */
    emptyLabel?: string
}>()

const modelValue = defineModel<StageId | undefined>({ required: true })
</script>

<template>
    <OptionalSelectField
        v-model="modelValue"
        :empty-label
        :label="i18n.modals.form.stage.label"
        :options="[...stages.entries()].map(([id, { name }]) => [name, id])"
    />
</template>
