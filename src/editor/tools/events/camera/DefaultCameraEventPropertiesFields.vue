<script setup lang="ts">
import { computed } from 'vue'
import { i18n } from '../../../../i18n'
import EmptyLabelProvider from '../../../../modals/form/EmptyLabelProvider.vue'
import { defaultCameraEventProperties } from '.'
import CopyPropertiesField from '../../../../modals/form/CopyPropertiesField.vue'
import OptionalCameraRotationField from '../../../../modals/form/OptionalCameraRotationField.vue'
import OptionalCameraSizeField from '../../../../modals/form/OptionalCameraSizeField.vue'
import OptionalCameraStageTiltField from '../../../../modals/form/OptionalCameraStageTiltField.vue'
import OptionalCameraZoomField from '../../../../modals/form/OptionalCameraZoomField.vue'
import OptionalCameraZoomTargetLaneField from '../../../../modals/form/OptionalCameraZoomTargetLaneField.vue'
import OptionalCameraZoomTargetYField from '../../../../modals/form/OptionalCameraZoomTargetYField.vue'
import OptionalCameraZoomVerticalAlignField from '../../../../modals/form/OptionalCameraZoomVerticalAlignField.vue'
import OptionalEventEaseField from '../../../../modals/form/OptionalEventEaseField.vue'
import { useProperties } from '../../../utils/properties'

const createModel = useProperties(defaultCameraEventProperties)

// Unset fields copy the selected object while Copy Properties is on.
const copyLabel = computed(() =>
    defaultCameraEventProperties.value.copyProperties
        ? i18n.value.modals.form.unset.copy
        : i18n.value.modals.form.unset.auto,
)

const cameraSize = createModel('cameraSize')
const cameraZoom = createModel('cameraZoom')
const cameraZoomTargetLane = createModel('cameraZoomTargetLane')
const cameraZoomTargetY = createModel('cameraZoomTargetY')
const cameraZoomVerticalAlign = createModel('cameraZoomVerticalAlign')
const cameraRotation = createModel('cameraRotation')
const cameraStageTilt = createModel('cameraStageTilt')
const eventEase = createModel('eventEase')
const copyProperties = createModel('copyProperties')
</script>

<template>
    <EmptyLabelProvider :label="copyLabel">
        <OptionalCameraSizeField v-model="cameraSize" />
        <OptionalCameraZoomField v-model="cameraZoom" />
        <OptionalCameraZoomTargetLaneField v-model="cameraZoomTargetLane" />
        <OptionalCameraZoomTargetYField v-model="cameraZoomTargetY" />
        <OptionalCameraZoomVerticalAlignField v-model="cameraZoomVerticalAlign" />
        <OptionalCameraRotationField v-model="cameraRotation" />
        <OptionalCameraStageTiltField v-model="cameraStageTilt" />
        <OptionalEventEaseField v-model="eventEase" />
    </EmptyLabelProvider>
    <CopyPropertiesField v-model="copyProperties" />
</template>
