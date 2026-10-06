<script setup lang="ts">
import { easeFamilies, type EaseEdit } from '../../ease'
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
        :label="qualified ? i18n.modals.form.eventEase.qualified : i18n.modals.form.eventEase.label"
        :mode-label="
            qualified ? i18n.modals.form.eventEase.qualifiedMode : i18n.modals.form.eventEase.mode
        "
        :families="easeFamilies"
    />
</template>
