<script setup lang="ts">
import type { CameraZoomVerticalAlign } from '../../chart/events/camera'
import { i18n } from '../../i18n'
import { useQualifiedLabels } from './qualifiedLabels'
import ChoiceField from './ChoiceField.vue'

const modelValue = defineModel<CameraZoomVerticalAlign | undefined>({ required: true })

const qualified = useQualifiedLabels()
</script>

<template>
    <ChoiceField
        v-model="modelValue"
        :label="
            qualified
                ? i18n.modals.form.cameraZoomVerticalAlign.qualified
                : i18n.modals.form.cameraZoomVerticalAlign.label
        "
        :options="[
            [i18n.modals.form.cameraZoomVerticalAlign.default, 'default'],
            [i18n.modals.form.cameraZoomVerticalAlign.center, 'center'],
        ]"
        variant="multi"
    />
</template>
