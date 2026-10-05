<script setup lang="ts">
import { computed } from 'vue'
import { i18n } from '../../../../../i18n'
import EmptyLabelProvider from '../../../../../modals/form/EmptyLabelProvider.vue'
import { defaultStageTransformEventProperties } from './index.ts'
import CopyPropertiesField from '../../../../../modals/form/CopyPropertiesField.vue'
import OptionalEventEaseField from '../../../../../modals/form/OptionalEventEaseField.vue'
import { useProperties } from '../../../../utils/properties.ts'
import OptionalRotationField from '../../../../../modals/form/OptionalRotationField.vue'
import OptionalYTranslationField from '../../../../../modals/form/OptionalYTranslationField.vue'
import OptionalAnchorField from '../../../../../modals/form/OptionalAnchorField.vue'
import OptionalElevationField from '../../../../../modals/form/OptionalElevationField.vue'

const createModel = useProperties(defaultStageTransformEventProperties)

// Unset fields copy the selected object while Copy Properties is on.
const copyLabel = computed(() =>
    defaultStageTransformEventProperties.value.copyProperties
        ? i18n.value.modals.form.unset.copy
        : i18n.value.modals.form.unset.auto,
)

const rotation = createModel('rotation')
const yTranslation = createModel('yTranslation')
const elevation = createModel('elevation')
const anchor = createModel('anchor')
const eventEase = createModel('eventEase')
const copyProperties = createModel('copyProperties')
</script>

<template>
    <EmptyLabelProvider :label="copyLabel">
        <OptionalRotationField v-model="rotation" />
        <OptionalYTranslationField v-model="yTranslation" />
        <OptionalAnchorField v-model="anchor" />
        <OptionalEventEaseField v-model="eventEase" />
        <OptionalElevationField v-model="elevation" />
    </EmptyLabelProvider>
    <CopyPropertiesField v-model="copyProperties" />
</template>
