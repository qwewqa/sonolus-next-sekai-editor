<script setup lang="ts">
import { saveAs } from 'file-saver'
import { computed, ref } from 'vue'
import { bgm } from '../../../history/bgm'
import { i18n } from '../../../i18n'
import { showModal } from '../../../modals'
import BaseModal from '../../../modals/BaseModal.vue'
import FileField from '../../../modals/form/FileField.vue'
import NumberField from '../../../modals/form/NumberField.vue'
import LoadingModal from '../../../modals/LoadingModal.vue'
import { loadBgm } from '../../../player'
import { formatTime } from '../../../utils/format'
import { remap, unlerp } from '../../../utils/math'
import { timeout } from '../../../utils/promise'

const buffer = ref(bgm.value.buffer)

const start = ref(0)
const end = ref(30)
const fadeStart = ref(1)
const fadeEnd = ref(1)

// The preview stops at the end of the audio, fading out there.
const clampedEnd = computed(() => Math.min(end.value, buffer.value?.duration ?? end.value))

// Why Generate is unavailable, if it is.
const problem = computed(() =>
    buffer.value && start.value >= buffer.value.duration
        ? i18n.value.utilities.previewEditor.startPastEnd
        : end.value <= start.value
          ? i18n.value.utilities.previewEditor.invalidRange
          : fadeStart.value + fadeEnd.value > end.value - start.value
            ? i18n.value.utilities.previewEditor.invalidFades
            : undefined,
)

const onSelect = (file: File) => {
    void showModal(LoadingModal, {
        title: () => i18n.value.utilities.previewEditor.title,
        async *task(signal: AbortSignal) {
            yield () => i18n.value.utilities.previewEditor.loading

            const data = await file.arrayBuffer()
            signal.throwIfAborted()

            yield () => i18n.value.utilities.previewEditor.decoding

            const decoded = await loadBgm(data)
            // decodeAudioData cannot be interrupted; discard a late result
            // instead of replacing audio selected after this task was closed.
            signal.throwIfAborted()
            buffer.value = decoded
        },
    })
}

const onGenerate = () => {
    void showModal(LoadingModal, {
        title: () => i18n.value.utilities.previewEditor.title,
        async *task(signal: AbortSignal) {
            yield () => i18n.value.utilities.previewEditor.generating
            await timeout(50)
            signal.throwIfAborted()

            if (!buffer.value) return

            const channels = [...Array(buffer.value.numberOfChannels).keys()].map((i) =>
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                buffer.value!.getChannelData(i),
            )

            const startSample = Math.floor(buffer.value.sampleRate * start.value)
            const startFadeSample = Math.floor(
                buffer.value.sampleRate * (start.value + fadeStart.value),
            )
            const endFadeSample = Math.floor(
                buffer.value.sampleRate * (clampedEnd.value - fadeEnd.value),
            )
            const endSample = Math.floor(buffer.value.sampleRate * clampedEnd.value)

            let range = 1
            for (const channel of channels) {
                for (let i = startSample; i <= endSample; i++) {
                    range = Math.max(range, Math.abs(channel[i] ?? 0))
                }
            }

            const buffers: Uint8Array<ArrayBuffer>[] = []

            const { Mp3Encoder } = await import('@breezystack/lamejs')
            signal.throwIfAborted()

            const encoder = new Mp3Encoder(
                buffer.value.numberOfChannels,
                buffer.value.sampleRate,
                192,
            )
            const chunkSize = 1152
            for (let i = startSample; i <= endSample; i += chunkSize) {
                // The last chunk stops at End.
                const chunkEnd = Math.min(i + chunkSize, endSample + 1)
                const chunk = encoder.encodeBuffer(
                    ...(channels.map(
                        (channel) =>
                            new Int16Array(
                                channel.slice(i, chunkEnd).map((value, j) => {
                                    if (i + j < startFadeSample) {
                                        value *= unlerp(startSample, startFadeSample, i + j)
                                    }

                                    if (i + j > endFadeSample) {
                                        value *= unlerp(endSample, endFadeSample, i + j)
                                    }

                                    return remap(-range, range, -32768, 32767, value)
                                }),
                            ),
                    ) as [Int16Array]),
                )
                if (chunk.length) buffers.push(chunk as never)
            }
            const chunk = encoder.flush()
            if (chunk.length) buffers.push(chunk as never)

            const blob = new Blob(buffers, {
                type: 'audio/mp3',
            })
            saveAs(blob, 'preview.mp3')
        },
    })
}
</script>

<template>
    <BaseModal :title="i18n.utilities.previewEditor.title">
        <div class="flex flex-col gap-3">
            <FileField
                :label="i18n.utilities.previewEditor.bgm"
                :value="buffer && formatTime(buffer.duration)"
                @select="onSelect"
            />
            <NumberField
                v-if="buffer"
                v-model="start"
                :label="i18n.utilities.previewEditor.start"
                :min="0"
                step="any"
            />
            <NumberField
                v-if="buffer"
                v-model="end"
                :label="i18n.utilities.previewEditor.end"
                :min="0"
                step="any"
            />
            <NumberField
                v-if="buffer"
                v-model="fadeStart"
                :label="i18n.utilities.previewEditor.fadeStart"
                :min="0"
                step="any"
            />
            <NumberField
                v-if="buffer"
                v-model="fadeEnd"
                :label="i18n.utilities.previewEditor.fadeEnd"
                :min="0"
                step="any"
            />
            <p v-if="buffer && problem" role="alert" class="text-sm text-danger">
                {{ problem }}
            </p>
        </div>

        <div v-if="buffer" class="flex justify-end">
            <button
                class="h-9 min-w-24 max-w-full truncate rounded-full bg-accent px-4 text-on-accent shadow-md outline-none -outline-offset-2 transition-colors hover:shadow-accent focus-visible:ring-2 focus-visible:ring-fg active:bg-button active:text-fg disabled:pointer-events-none disabled:opacity-40 [@media(pointer:coarse)]:h-11"
                :disabled="!!problem"
                @click="onGenerate"
            >
                {{ i18n.utilities.previewEditor.generate }}
            </button>
        </div>
    </BaseModal>
</template>
