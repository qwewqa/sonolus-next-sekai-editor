<script setup lang="ts">
import { computed, ref, useTemplateRef, onMounted, watch } from 'vue'
import { i18n } from '../../../i18n'
import BaseModal from '../../../modals/BaseModal.vue'
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
const title = computed(() =>
    session.value?.axis === 'elevation'
        ? i18n.value.commands.scaleElevation.title
        : i18n.value.commands.scaleBeat.title,
)
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
onMounted(() => {
    input.value?.focus()
    input.value?.select()
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
