<script setup lang="ts">
import { computed } from 'vue'
import { i18n } from '../../../i18n'
import EmptyLabelProvider from '../../../modals/form/EmptyLabelProvider.vue'
import { defaultSlideProperties, defaultSlidePropertiesPresetIndex } from '.'
import CopyPropertiesField from '../../../modals/form/CopyPropertiesField.vue'
import OptionalConnectorActiveIsCriticalField from '../../../modals/form/OptionalConnectorActiveIsCriticalField.vue'
import OptionalConnectorIsFakeField from '../../../modals/form/OptionalConnectorIsFakeField.vue'
import OptionalConnectorEaseField from '../../../modals/form/OptionalConnectorEaseField.vue'
import OptionalConnectorGuideAlphaField from '../../../modals/form/OptionalConnectorGuideAlphaField.vue'
import OptionalConnectorIsPassThroughField from '../../../modals/form/OptionalConnectorIsPassThroughField.vue'
import OptionalConnectorLayerField from '../../../modals/form/OptionalConnectorLayerField.vue'
import OptionalConnectorPresentationField from '../../../modals/form/OptionalConnectorPresentationField.vue'
import OptionalConnectorTypeField from '../../../modals/form/OptionalConnectorTypeField.vue'
import OptionalFlickDirectionField from '../../../modals/form/OptionalFlickDirectionField.vue'
import OptionalIsAttachedField from '../../../modals/form/OptionalIsAttachedField.vue'
import OptionalIsConnectorSeparatorField from '../../../modals/form/OptionalIsConnectorSeparatorField.vue'
import OptionalIsCriticalField from '../../../modals/form/OptionalIsCriticalField.vue'
import OptionalIsFakeField from '../../../modals/form/OptionalIsFakeField.vue'
import OptionalNoteTypeField from '../../../modals/form/OptionalNoteTypeField.vue'
import OptionalElevationField from '../../../modals/form/OptionalElevationField.vue'
import OptionalNoteStyleField from '../../../modals/form/OptionalNoteStyleField.vue'
import OptionalConnectorStyleField from '../../../modals/form/OptionalConnectorStyleField.vue'
import OptionalSfxField from '../../../modals/form/OptionalSfxField.vue'
import PresetField from '../../../modals/form/PresetField.vue'
import { settings } from '../../../settings'
import { useProperties } from '../../utils/properties'

const createModel = useProperties(defaultSlideProperties)

// Unset fields copy the selected object while Copy Properties is on.
const copyLabel = computed(() =>
    defaultSlideProperties.value.copyProperties
        ? i18n.value.modals.form.unset.copy
        : i18n.value.modals.form.unset.auto,
)

const elevation = createModel('elevation')
const noteStyle = createModel('noteStyle')
const connectorStyle = createModel('connectorStyle')
const noteType = createModel('noteType')
const isAttached = createModel('isAttached')
const isCritical = createModel('isCritical')
const flickDirection = createModel('flickDirection')
const isFake = createModel('isFake')
const sfx = createModel('sfx')
const isConnectorSeparator = createModel('isConnectorSeparator')
const connectorType = createModel('connectorType')
const connectorEase = createModel('connectorEase')
const connectorIsFake = createModel('connectorIsFake')
const connectorActiveIsCritical = createModel('connectorActiveIsCritical')
const connectorGuideAlpha = createModel('connectorGuideAlpha')
const connectorLayer = createModel('connectorLayer')
const connectorIsPassThrough = createModel('connectorIsPassThrough')
const connectorPresentation = createModel('connectorPresentation')
const copyProperties = createModel('copyProperties')
</script>

<template>
    <PresetField
        v-model="defaultSlidePropertiesPresetIndex"
        :count="settings.defaultSlidePropertiesPresets.length"
    />
    <EmptyLabelProvider :label="copyLabel">
        <OptionalNoteTypeField v-model="noteType" />
        <OptionalNoteStyleField v-model="noteStyle" />
        <OptionalIsAttachedField v-model="isAttached" />
        <OptionalIsCriticalField v-model="isCritical" />
        <OptionalFlickDirectionField v-model="flickDirection" />
        <OptionalIsFakeField v-model="isFake" />
        <OptionalSfxField v-model="sfx" />
    </EmptyLabelProvider>
    <EmptyLabelProvider :label="i18n.modals.form.unset.auto">
        <OptionalIsConnectorSeparatorField v-model="isConnectorSeparator" />
    </EmptyLabelProvider>
    <EmptyLabelProvider :label="copyLabel">
        <OptionalConnectorTypeField v-model="connectorType" />
        <OptionalConnectorStyleField v-model="connectorStyle" />
    </EmptyLabelProvider>
    <EmptyLabelProvider :label="i18n.modals.form.unset.auto">
        <OptionalConnectorEaseField v-model="connectorEase" />
    </EmptyLabelProvider>
    <EmptyLabelProvider :label="copyLabel">
        <OptionalConnectorIsFakeField v-model="connectorIsFake" />
        <OptionalConnectorActiveIsCriticalField v-model="connectorActiveIsCritical" />
        <OptionalConnectorGuideAlphaField v-model="connectorGuideAlpha" />
        <OptionalConnectorLayerField v-model="connectorLayer" />
        <OptionalConnectorIsPassThroughField v-model="connectorIsPassThrough" />
        <OptionalConnectorPresentationField v-model="connectorPresentation" />
        <OptionalElevationField v-model="elevation" />
    </EmptyLabelProvider>
    <CopyPropertiesField v-model="copyProperties" />
</template>
