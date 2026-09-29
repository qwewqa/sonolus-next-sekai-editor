<script setup lang="ts">
import type { NoteStyle } from '../../chart/noteStyle'
import { i18n } from '../../i18n'
import { noteStyleOptions } from './noteStyleOptions'
import MultiSelectField from './MultiSelectField.vue'

const modelValue = defineModel<NoteStyle | undefined>({ required: true })
</script>

<template>
    <MultiSelectField
        v-model="modelValue"
        :label="i18n.modals.form.connectorStyle.label"
        :options="noteStyleOptions"
    />
</template>
