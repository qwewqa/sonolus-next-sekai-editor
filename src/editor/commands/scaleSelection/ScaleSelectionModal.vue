<script setup lang="ts">
import { computed, ref, useTemplateRef, onMounted, onUnmounted, watch } from 'vue'
import { i18n } from '../../../i18n'
import BaseModal from '../../../modals/BaseModal.vue'
import BaseField from '../../../modals/form/BaseField.vue'
import { modals } from '../../../modals'
import { isComposingKey } from '../../../utils/composition'
import { getScaleLabels } from './labels'
import {
    scalingSession,
    setScalingFactor,
    applyScalingSession,
    cancelScalingSession,
} from './session'

const props = defineProps<{ sessionId: number }>()
const emit = defineEmits<{ close: [] }>()
const session = computed(() =>
    scalingSession.value?.id === props.sessionId ? scalingSession.value : undefined,
)
const factor = ref<number | string>(session.value?.requestedFactor ?? 1)
const input = useTemplateRef<HTMLInputElement>('input')
const title = computed(() => getScaleLabels(session.value?.axis ?? 'beat').title)
watch(
    () => session.value?.requestedFactor,
    (value) => {
        if (
            value !== undefined &&
            !Object.is(factor.value === '' ? NaN : Number(factor.value), value)
        )
            factor.value = value
    },
)
watch(session, (value) => {
    if (!value) emit('close')
})
const update = () => setScalingFactor(factor.value === '' ? NaN : Number(factor.value))
const cancel = () => {
    if (session.value) cancelScalingSession()
    emit('close')
}
const apply = () => {
    if (applyScalingSession()) emit('close')
}
const onKeydown = (event: KeyboardEvent) => {
    const modal = modals.at(-1)
    if (
        event.key !== 'Enter' ||
        event.defaultPrevented ||
        isComposingKey(event) ||
        event.repeat ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        event.shiftKey ||
        (event.target instanceof Element && event.target.closest('button')) ||
        !modal ||
        !('sessionId' in modal.props) ||
        modal.props.sessionId !== props.sessionId
    )
        return
    event.preventDefault()
    event.stopImmediatePropagation()
    apply()
}
onMounted(() => {
    window.addEventListener('keydown', onKeydown, true)
    input.value?.focus()
    input.value?.select()
})
onUnmounted(() => {
    window.removeEventListener('keydown', onKeydown, true)
})
</script>

<template>
    <div class="scaling-panel flex min-h-0 flex-col" :data-axis="session?.axis">
        <BaseModal :title @close="cancel">
            <form novalidate @submit.prevent="apply">
                <div class="flex flex-col gap-3">
                    <BaseField :label="i18n.commands.scaleSelection.factor">
                        <input
                            ref="input"
                            v-model="factor"
                            class="w-full appearance-none rounded-full bg-button px-4 py-1 shadow-md transition-colors hover:shadow-accent focus:outline-none focus:ring-2 focus:ring-fg active:bg-accent active:text-on-accent"
                            type="number"
                            min="0"
                            step="0.1"
                            required
                            :aria-invalid="!session?.valid"
                            @input="update"
                        />
                    </BaseField>
                    <p v-if="session && !session.valid" role="alert" class="text-sm text-danger">
                        {{ i18n.commands.scaleSelection.invalidFactor }}
                    </p>
                </div>
                <div class="mt-4 flex justify-end gap-2">
                    <button
                        type="button"
                        class="h-9 min-w-24 max-w-full truncate rounded-full bg-button px-4 shadow-md transition-colors hover:shadow-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg active:bg-accent active:text-on-accent [@media(pointer:coarse)]:h-11"
                        @click="cancel"
                    >
                        {{ i18n.modals.confirm.cancel }}
                    </button>
                    <button
                        type="submit"
                        class="h-9 min-w-24 max-w-full truncate rounded-full bg-accent px-4 text-on-accent shadow-md transition-colors hover:shadow-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg active:bg-button active:text-fg disabled:pointer-events-none disabled:opacity-40 [@media(pointer:coarse)]:h-11"
                        :disabled="!session?.valid"
                    >
                        {{ i18n.commands.scaleSelection.apply }}
                    </button>
                </div>
            </form>
        </BaseModal>
    </div>
</template>
