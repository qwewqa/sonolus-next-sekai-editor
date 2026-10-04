<script setup lang="ts">
import { ref } from 'vue'
import { i18n } from '../../../i18n'
import FormModal from '../../../modals/form/FormModal.vue'
import NumberField from '../../../modals/form/NumberField.vue'
import { settings } from '../../../settings'

defineEmits<{ close: [maxLane?: number] }>()
const model = ref(settings.customMaxLane)
</script>

<template>
    <FormModal
        :title="i18n.commands.laneLimits.custom"
        @close="$emit('close')"
        @submit="$emit('close', model)"
    >
        <NumberField
            v-model="model"
            :label="i18n.commands.laneLimits.maximum"
            :min="Number.MIN_VALUE"
            :max="Number.MAX_SAFE_INTEGER"
            step="any"
        />
    </FormModal>
</template>
