<script setup lang="ts">
import { i18n } from '../../i18n'
import { useQualifiedLabels } from './qualifiedLabels'
import MultiNumberField from './MultiNumberField.vue'

const modelValue = defineModel<number | undefined>({ required: true })

const qualified = useQualifiedLabels()
</script>

<template>
    <MultiNumberField
        v-model="modelValue"
        :label="
            qualified ? i18n.modals.form.cameraLeft.qualified : i18n.modals.form.cameraLeft.label
        "
        step="any"
    />
</template>
