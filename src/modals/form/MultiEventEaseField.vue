<script setup lang="ts">
import { easeFunctionNames, type EaseEdit } from '../../ease'
import { i18n } from '../../i18n'
import EaseField from './EaseField.vue'

defineProps<{
    /** Names the events, for the shared field across event kinds. */
    qualified?: boolean
}>()

const modelValue = defineModel<EaseEdit | undefined>({ required: true })
</script>

<template>
    <EaseField
        v-model="modelValue"
        :type-label="
            qualified ? i18n.modals.form.eventEase.qualifiedType : i18n.modals.form.eventEase.type
        "
        :function-label="
            qualified
                ? i18n.modals.form.eventEase.qualifiedFunction
                : i18n.modals.form.eventEase.function
        "
        :functions="easeFunctionNames"
    />
</template>
