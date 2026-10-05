<script setup lang="ts">
import { computed } from 'vue'
import type { FlickDirection } from '../../chart/note'
import { i18n } from '../../i18n'
import OptionalSelectField from './OptionalSelectField.vue'
import { flickArrowPoints } from '../../flickArrow'
import FlickIcon from './FlickIcon.vue'

const modelValue = defineModel<FlickDirection | undefined>({ required: true })

// None, unset, mixed and unknown values have no arrow.
const glyph = computed(() =>
    modelValue.value && modelValue.value in flickArrowPoints
        ? (modelValue.value as keyof typeof flickArrowPoints)
        : undefined,
)
</script>

<template>
    <OptionalSelectField
        v-model="modelValue"
        :label="i18n.modals.form.flickDirection.label"
        :options="[
            [i18n.modals.form.flickDirection.none, 'none'],
            [i18n.modals.form.flickDirection.up, 'up'],
            [i18n.modals.form.flickDirection.upLeft, 'upLeft'],
            [i18n.modals.form.flickDirection.upRight, 'upRight'],
            [i18n.modals.form.flickDirection.down, 'down'],
            [i18n.modals.form.flickDirection.downLeft, 'downLeft'],
            [i18n.modals.form.flickDirection.downRight, 'downRight'],
        ]"
    >
        <template v-if="glyph" #leading><FlickIcon :direction="glyph" /></template>
    </OptionalSelectField>
</template>
