<script setup lang="ts">
import { computed, ref, useTemplateRef, onMounted, onUnmounted, watch } from 'vue'
import { i18n } from '../../../i18n'
import BaseModal from '../../../modals/BaseModal.vue'
import { modals } from '../../../modals'
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
        event.isComposing ||
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
                <div class="flex flex-col gap-2">
                    <label class="flex items-center justify-between gap-3">
                        <span>{{ i18n.commands.scaleSelection.factor }}</span>
                        <input
                            ref="input"
                            v-model="factor"
                            class="w-28 rounded-full bg-button px-4 py-1 shadow-md transition-colors hover:shadow-accent active:bg-accent active:text-button"
                            type="number"
                            min="0"
                            step="0.1"
                            required
                            :aria-invalid="!session?.valid"
                            @input="update"
                        />
                    </label>
                    <p v-if="session && !session.valid" role="alert" class="text-sm">
                        {{ i18n.commands.scaleSelection.invalidFactor }}
                    </p>
                </div>
                <div class="mt-3 flex justify-end gap-2">
                    <button
                        type="button"
                        class="rounded-full bg-button px-4 py-1 shadow-md hover:shadow-accent"
                        @click="cancel"
                    >
                        {{ i18n.modals.confirm.cancel }}
                    </button>
                    <button
                        type="submit"
                        class="rounded-full bg-accent px-4 py-1 shadow-md hover:shadow-accent disabled:opacity-50"
                        :disabled="!session?.valid"
                    >
                        {{ i18n.commands.scaleSelection.apply }}
                    </button>
                </div>
            </form>
        </BaseModal>
    </div>
</template>
