<script setup lang="ts">
import { computed, ref } from 'vue'
import { i18n } from '../../../i18n'
import FormModal from '../../../modals/form/FormModal.vue'
import NumberField from '../../../modals/form/NumberField.vue'
import { view } from '../../view'

defineEmits<{
    close: [division?: number]
}>()

const { axis = 'beat' } = defineProps<{ axis?: 'beat' | 'lane' }>()
const labels = computed(() =>
    axis === 'lane'
        ? i18n.value.commands.laneDivisions.custom.modal
        : i18n.value.commands.divisions.custom.modal,
)
const model = ref(axis === 'lane' ? view.laneDivision : view.division)
</script>

<template>
    <FormModal :title="labels.title" @close="$emit('close')" @submit="$emit('close', model)">
        <NumberField
            v-model="model"
            :label="labels.division"
            :min="1"
            :max="Number.MAX_SAFE_INTEGER"
            :step="1"
        />
    </FormModal>
</template>
