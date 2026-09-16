<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { i18n } from '../i18n'
import BaseModal from './BaseModal.vue'

const props = defineProps<{
    title: () => string
    task: (signal: AbortSignal) => AsyncIterable<() => string> | Iterable<() => string>
}>()

const emit = defineEmits<{
    close: []
}>()

const message = ref(() => i18n.value.modals.loading.loading)

const controller = new AbortController()
onBeforeUnmount(() => {
    controller.abort()
})
onMounted(async () => {
    try {
        for await (const next of props.task(controller.signal)) {
            if (controller.signal.aborted) return
            message.value = next
        }

        if (!controller.signal.aborted) emit('close')
    } catch (error) {
        if (
            controller.signal.aborted ||
            (error instanceof DOMException && error.name === 'AbortError')
        ) {
            if (!controller.signal.aborted) emit('close')
            return
        }
        console.error(error)

        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        message.value = () => `${error}`
    }
})

const onClose = () => {
    controller.abort()
    emit('close')
}
</script>

<template>
    <BaseModal :title="title()" @close="onClose">
        <span class="whitespace-break-spaces">{{ message() }}</span>
    </BaseModal>
</template>
