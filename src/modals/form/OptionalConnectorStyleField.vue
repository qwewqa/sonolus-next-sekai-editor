<script setup lang="ts">
import { computed } from 'vue'
import { i18n } from '../../i18n'
import { noteStyleOptions } from './noteStyleOptions'
import OptionalSelectField from './OptionalSelectField.vue'
import { noteStyles, type NoteStyle } from '../../chart/noteStyle'
import NoteStyleSwatch from './NoteStyleSwatch.vue'

const modelValue = defineModel<NoteStyle | undefined>({ required: true })

// Unset, mixed and unknown values have no swatch.
const glyph = computed(() => noteStyles.find((style) => style === modelValue.value))
</script>

<template>
    <OptionalSelectField
        v-model="modelValue"
        :label="i18n.modals.form.connectorStyle.label"
        :options="noteStyleOptions"
    >
        <template v-if="glyph" #leading><NoteStyleSwatch :value="glyph" connector /></template>
    </OptionalSelectField>
</template>
