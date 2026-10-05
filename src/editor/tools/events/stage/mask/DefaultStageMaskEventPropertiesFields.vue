<script setup lang="ts">
import { computed } from 'vue'
import { i18n } from '../../../../../i18n'
import EmptyLabelProvider from '../../../../../modals/form/EmptyLabelProvider.vue'
import { defaultStageMaskEventProperties } from '.'
import CopyPropertiesField from '../../../../../modals/form/CopyPropertiesField.vue'
import OptionalEventEaseField from '../../../../../modals/form/OptionalEventEaseField.vue'
import OptionalIsMaskNotesField from '../../../../../modals/form/OptionalIsMaskNotesField.vue'
import OptionalMaskSizeField from '../../../../../modals/form/OptionalMaskSizeField.vue'
import { useProperties } from '../../../../utils/properties'

const createModel = useProperties(defaultStageMaskEventProperties)

// Unset fields copy the selected object while Copy Properties is on.
const copyLabel = computed(() =>
    defaultStageMaskEventProperties.value.copyProperties
        ? i18n.value.modals.form.unset.copy
        : i18n.value.modals.form.unset.auto,
)

const maskSize = createModel('maskSize')
const eventEase = createModel('eventEase')
const isMaskNotes = createModel('isMaskNotes')
const copyProperties = createModel('copyProperties')
</script>

<template>
    <EmptyLabelProvider :label="copyLabel">
        <OptionalMaskSizeField v-model="maskSize" />
        <OptionalIsMaskNotesField v-model="isMaskNotes" />
        <OptionalEventEaseField v-model="eventEase" />
    </EmptyLabelProvider>
    <CopyPropertiesField v-model="copyProperties" />
</template>
