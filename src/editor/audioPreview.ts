import { shallowRef } from 'vue'

// Audio auditioning has its own position so selecting or dragging an object
// does not seek or invalidate the visual preview.
export const audioPreviewRequest = shallowRef<{ time: number }>()

let lastTime: number | undefined

export const beginAudioPreviewInteraction = () => {
    lastTime = undefined
}

export const requestAudioPreview = (time: number) => {
    if (time === lastTime) return
    lastTime = time
    audioPreviewRequest.value = { time }
}
