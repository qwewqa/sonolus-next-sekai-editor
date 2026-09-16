<script setup lang="ts">
import { onBeforeUnmount, shallowReactive, watch } from 'vue'
import { state } from '../../../history'
import { i18n } from '../../../i18n'
import { showModal } from '../../../modals'
import FileField from '../../../modals/form/FileField.vue'
import FormModal from '../../../modals/form/FormModal.vue'
import NumberField from '../../../modals/form/NumberField.vue'
import LoadingModal from '../../../modals/LoadingModal.vue'
import { loadBgm } from '../../../player'
import { settings } from '../../../settings'
import type { Bgm } from '../../../state/bgm'
import { getFilename } from '../../../utils/file'
import { formatTime } from '../../../utils/format'
import { timeout } from '../../../utils/promise'
import { createWaveform, releaseWaveform, type Waveform } from '../../../waveform'

const props = defineProps<{
    bgm: Bgm
    file?: File
}>()

const emit = defineEmits<{
    close: [bgm?: Bgm]
}>()

const model = shallowReactive({
    ...props.bgm,
    offset: props.bgm.offset * 1000,
})

let request: AbortController | undefined
let ownedWaveform: Waveform | undefined

const onClose = () => {
    request?.abort()
    emit('close')
}

onBeforeUnmount(() => {
    request?.abort()
    releaseWaveform(ownedWaveform)
})
watch(() => state.value.store, onClose, { flush: 'sync' })

const onSelect = (file: File) => {
    request?.abort()
    const current = new AbortController()
    request = current

    void showModal(LoadingModal, {
        title: () => i18n.value.commands.bgm.title,
        async *task(signal: AbortSignal) {
            const cancel = () => {
                current.abort()
            }
            const checkCancelled = () => {
                if (current.signal.aborted || signal.aborted) {
                    throw new DOMException('BGM import cancelled', 'AbortError')
                }
            }
            signal.addEventListener('abort', cancel, { once: true })
            let waveform: Waveform | undefined
            let published = false
            try {
                checkCancelled()
                yield () => i18n.value.commands.bgm.modal.loading

                const data = await file.arrayBuffer()
                checkCancelled()

                yield () => i18n.value.commands.bgm.modal.decoding

                const buffer = await loadBgm(data)
                checkCancelled()

                yield () => i18n.value.commands.bgm.modal.generating
                await timeout(50)
                checkCancelled()

                waveform = await createWaveform(buffer, settings.waveform, current.signal)
                checkCancelled()

                releaseWaveform(ownedWaveform)
                ownedWaveform = waveform
                model.filename = getFilename(file)
                model.buffer = buffer
                model.waveform = waveform
                published = true
            } finally {
                signal.removeEventListener('abort', cancel)
                if (!published) releaseWaveform(waveform)
                if (request === current) request = undefined
            }
        },
    })
}

if (props.file) {
    onSelect(props.file)
}

const onSubmit = () => {
    request?.abort()
    // Ownership passes to chart history only after the user confirms this BGM.
    ownedWaveform = undefined
    emit('close', {
        // eslint-disable-next-line @typescript-eslint/no-misused-spread
        ...model,
        offset: model.offset / 1000,
    })
}
</script>

<template>
    <FormModal :title="i18n.commands.bgm.title" @close="onClose" @submit="onSubmit">
        <FileField
            :label="i18n.commands.bgm.modal.file"
            :value="model.buffer && formatTime(model.buffer.duration)"
            @select="onSelect"
        />
        <NumberField v-model="model.offset" :label="i18n.commands.bgm.modal.offset" step="any" />
    </FormModal>
</template>
