<script setup lang="ts">
import { computed, ref, useTemplateRef, onMounted } from 'vue'
import { i18n } from '../../../i18n'
import FormModal from '../../../modals/form/FormModal.vue'
import BaseField from '../../../modals/form/BaseField.vue'
import type { State } from '../../../state'
import type { Entity } from '../../../state/entities'
import {
    getScalePivot,
    getScaledSelectionValues,
    type ScaleAxis,
} from '../../../state/operations/scaleValues'

const props = defineProps<{ source: State; selected: Entity[]; axis: ScaleAxis }>()
const emit = defineEmits<{ close: [factor?: number] }>()
const factor = ref<number | string>(2)
const invalid = ref(false)
const input = useTemplateRef<HTMLInputElement>('input')
const pivot = computed(() => getScalePivot(props.selected, props.axis, props.source))
const title = computed(() =>
    props.axis === 'beat'
        ? i18n.value.commands.scaleBeat.title
        : i18n.value.commands.scaleElevation.title,
)
const apply = () => {
    const value = Number(factor.value)
    if (
        !Number.isFinite(value) ||
        value <= 0 ||
        (value !== 1 && !getScaledSelectionValues(props.selected, props.axis, value, props.source))
    ) {
        invalid.value = true
        input.value?.focus()
        return
    }
    emit('close', value)
}
onMounted(() => {
    input.value?.focus()
    input.value?.select()
})
</script>

<template>
    <FormModal
        :title
        :submit-label="i18n.commands.scaleSelection.apply"
        @close="$emit('close')"
        @submit="apply"
    >
        <BaseField :label="i18n.commands.scaleSelection.factor">
            <input
                ref="input"
                v-model="factor"
                class="w-full appearance-none rounded-full bg-button px-4 py-1 shadow-md transition-colors hover:shadow-accent active:bg-accent active:text-button"
                type="number"
                min="0"
                step="any"
                required
                @input="invalid = false"
            />
        </BaseField>
        <BaseField
            :label="
                axis === 'beat'
                    ? i18n.commands.scaleSelection.pivotBeat
                    : i18n.commands.scaleSelection.pivotElevation
            "
        >
            <span class="px-4 py-1">{{ pivot }}</span>
        </BaseField>
        <p v-if="invalid" role="alert" class="text-sm">
            {{ i18n.commands.scaleSelection.invalidFactor }}
        </p>
    </FormModal>
</template>
