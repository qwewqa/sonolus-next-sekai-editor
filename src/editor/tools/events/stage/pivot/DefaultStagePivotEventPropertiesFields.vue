<script setup lang="ts">
import { computed } from 'vue'
import { i18n } from '../../../../../i18n'
import EmptyLabelProvider from '../../../../../modals/form/EmptyLabelProvider.vue'
import { defaultStagePivotEventProperties } from '.'
import CopyPropertiesField from '../../../../../modals/form/CopyPropertiesField.vue'
import OptionalDivisionParityField from '../../../../../modals/form/OptionalDivisionParityField.vue'
import OptionalDivisionSizeField from '../../../../../modals/form/OptionalDivisionSizeField.vue'
import OptionalEventEaseField from '../../../../../modals/form/OptionalEventEaseField.vue'
import OptionalYOffsetBeatField from '../../../../../modals/form/OptionalYOffsetBeatField.vue'
import OptionalYOffsetField from '../../../../../modals/form/OptionalYOffsetField.vue'
import { useProperties } from '../../../../utils/properties'

const createModel = useProperties(defaultStagePivotEventProperties)

// Unset fields copy the selected object while Copy Properties is on.
const copyLabel = computed(() =>
    defaultStagePivotEventProperties.value.copyProperties
        ? i18n.value.modals.form.unset.copy
        : i18n.value.modals.form.unset.default,
)

const divisionSize = createModel('divisionSize')
const divisionParity = createModel('divisionParity')
const yOffset = createModel('yOffset')
const yOffsetBeat = createModel('yOffsetBeat')
const eventEase = createModel('eventEase')
const copyProperties = createModel('copyProperties')
</script>

<template>
    <EmptyLabelProvider :label="copyLabel">
        <OptionalDivisionSizeField v-model="divisionSize" />
        <OptionalDivisionParityField v-model="divisionParity" />
        <OptionalYOffsetField v-model="yOffset" />
        <OptionalYOffsetBeatField v-model="yOffsetBeat" />
        <OptionalEventEaseField v-model="eventEase" />
    </EmptyLabelProvider>
    <CopyPropertiesField v-model="copyProperties" />
</template>
