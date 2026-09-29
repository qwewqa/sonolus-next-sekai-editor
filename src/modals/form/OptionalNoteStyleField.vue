<script setup lang="ts">
import type { NoteStyle } from '../../chart/noteStyle'
import { i18n } from '../../i18n'
import { noteStyleOptions } from './noteStyleOptions'
import OptionalSelectField from './OptionalSelectField.vue'

const modelValue = defineModel<NoteStyle | undefined>({ required: true })
</script>

<template>
    <OptionalSelectField
        v-model="modelValue"
        :label="i18n.modals.form.noteStyle.label"
        :options="noteStyleOptions"
    />
</template>
