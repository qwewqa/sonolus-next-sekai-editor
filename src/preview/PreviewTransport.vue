<script setup lang="ts">
import { computed, nextTick, useId, useTemplateRef, watch } from 'vue'
import PlayIcon from '../editor/commands/play/PlayIcon.vue'
import { togglePreviewPlayback } from '../editor/player'
import { view } from '../editor/view'
import { isPlaying } from '../player'
import { i18n } from '../i18n'
import { formatTime } from '../utils/format'
import { interpolateRaw } from '../utils/interpolate'
import { useTransportInput } from './useTransportInput'

const props = defineProps<{
    viewportLeft: number
    viewportTop: number
    viewportBottom: number
    persistent: boolean
}>()
const emit = defineEmits<{
    resize: [height: number, width: number, right: number]
    timeResize: [width: number, height: number]
}>()
const visible = defineModel<boolean>({ required: true })
const panelId = useId()
const panel = useTemplateRef<HTMLDivElement>('panel')
const toggle = useTemplateRef<HTMLButtonElement>('toggle')
const cornerTime = useTemplateRef<HTMLSpanElement>('cornerTime')
const position = computed(() =>
    visible.value || !isPlaying.value ? formatTime(Math.round(view.cursorTime * 1000) / 1000) : '',
)
const {
    activeStep,
    onWheel,
    onPointerDown,
    onPointerUp,
    onPointerCancel,
    onStepKeydown,
    onStepKeyup,
    onStepBlur,
    onStepClick,
    cancel,
} = useTransportInput(visible)

const blurPointerButton = (event: MouseEvent) => {
    if (event.detail) (event.currentTarget as HTMLButtonElement).blur()
}

const toggleVisibility = (event: MouseEvent) => {
    if (props.persistent) return
    cancel()
    visible.value = !visible.value
    blurPointerButton(event)
}

const hide = (event: MouseEvent | KeyboardEvent) => {
    cancel()
    if (props.persistent) {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
        return
    }
    visible.value = false
    if (event instanceof KeyboardEvent || !event.detail) {
        void nextTick(() => toggle.value?.focus({ preventScroll: true }))
    }
}

const play = (event: MouseEvent) => {
    cancel()
    togglePreviewPlayback()
    blurPointerButton(event)
}

watch(
    panel,
    (element, _previous, onCleanup) => {
        if (!element) {
            emit('resize', 0, 0, 0)
            return
        }
        const root = element.parentElement
        if (!root) return
        let height = -1
        let width = -1
        let right = -1
        const update = () => {
            const panelBounds = element.getBoundingClientRect()
            const rootBounds = root.getBoundingClientRect()
            const nextHeight = panelBounds.height
            const nextWidth = rootBounds.width
            const nextRight = panelBounds.right - rootBounds.left
            if (nextHeight === height && nextWidth === width && nextRight === right) return
            height = nextHeight
            width = nextWidth
            right = nextRight
            emit('resize', height, width, right)
        }
        const observer = new ResizeObserver(update)
        observer.observe(element)
        // The bar can reach its maximum width while its container keeps growing.
        observer.observe(root)
        update()
        onCleanup(() => {
            observer.disconnect()
        })
    },
    { flush: 'post', immediate: true },
)

watch(cornerTime, (element, _previous, onCleanup) => {
    if (!element) {
        emit('timeResize', 0, 0)
        return
    }
    const update = () => {
        const { width, height } = element.getBoundingClientRect()
        emit('timeResize', width, height)
    }
    const observer = new ResizeObserver(update)
    observer.observe(element)
    update()
    onCleanup(() => {
        observer.disconnect()
    })
})
</script>

<template>
    <div
        class="preview-transport-root pointer-events-auto absolute inset-0 z-10"
        :style="{ '--preview-bottom': `${viewportBottom}px` }"
        @wheel="onWheel"
    >
        <button
            v-if="!persistent"
            ref="toggle"
            type="button"
            class="preview-transport-toggle pointer-events-auto absolute inset-0 h-full w-full touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fg"
            :aria-label="visible ? i18n.preview.transport.hide : i18n.preview.transport.show"
            :aria-expanded="visible"
            :aria-controls="panelId"
            @click.stop="toggleVisibility"
            @keydown.stop
        />
        <span
            v-if="!isPlaying"
            ref="cornerTime"
            class="transport-corner-time pointer-events-none absolute z-10 rounded-full bg-modal px-1 py-0.5 font-mono text-[10px] tabular-nums leading-4 text-fg shadow-md"
            :style="{ left: `${viewportLeft + 4}px`, top: `${viewportTop + 4}px` }"
            :aria-label="i18n.preview.transport.time"
        >
            {{ position }}
        </span>
        <div
            :id="panelId"
            ref="panel"
            class="preview-transport absolute z-20 grid items-center gap-1 rounded-xl bg-modal px-1.5 py-1 text-fg shadow-xl"
            :class="visible ? 'pointer-events-auto' : 'pointer-events-none invisible'"
            :inert="!visible"
            :aria-hidden="!visible"
            role="group"
            :aria-label="i18n.preview.transport.controls"
            @click.stop
            @keydown.stop
            @keydown.esc.prevent="hide"
            @pointerdown.stop
            @contextmenu.prevent
        >
            <button
                type="button"
                class="transport-button"
                :aria-label="isPlaying ? i18n.preview.transport.pause : i18n.preview.transport.play"
                :title="isPlaying ? i18n.preview.transport.pause : i18n.preview.transport.play"
                @click="play"
            >
                <PlayIcon :state="isPlaying" class="size-4 fill-current" aria-hidden="true" />
            </button>
            <span
                class="transport-time px-1 text-center font-mono text-xs tabular-nums"
                :aria-label="i18n.preview.transport.time"
            >
                {{ position }}
            </span>
            <div class="transport-steps grid min-w-0 grid-cols-6 gap-0.5">
                <button
                    v-for="step in [-100, -10, -1, 1, 10, 100]"
                    :key="step"
                    type="button"
                    class="transport-button touch-none select-none flex-col"
                    :class="{ 'is-held': activeStep === step }"
                    :aria-label="
                        interpolateRaw(
                            step < 0 ? i18n.preview.transport.back : i18n.preview.transport.forward,
                            `${Math.abs(step)}`,
                        )
                    "
                    :title="
                        interpolateRaw(
                            step < 0
                                ? i18n.preview.transport.holdBackward
                                : i18n.preview.transport.holdForward,
                            `${Math.abs(step) / 10}`,
                        )
                    "
                    @pointerdown="onPointerDown($event, step)"
                    @pointerup="onPointerUp"
                    @pointercancel="onPointerCancel"
                    @lostpointercapture="onPointerCancel"
                    @keydown="onStepKeydown($event, step)"
                    @keyup="onStepKeyup"
                    @blur="onStepBlur"
                    @click.prevent="onStepClick($event, step)"
                >
                    <span class="font-mono text-xs tabular-nums leading-4" aria-hidden="true">
                        {{ step < 0 ? '−' : '+' }}{{ Math.abs(step) }}
                    </span>
                    <span class="text-[10px] leading-3 opacity-75" aria-hidden="true">ms</span>
                </button>
            </div>
        </div>
    </div>
</template>

<style scoped>
.preview-transport-root {
    container-type: inline-size;
}

.preview-transport {
    --transport-height: 2.75rem;
    grid-template-columns: 2.25rem minmax(0, 1fr);
    left: max(0.25rem, calc((100% - 40rem) / 2));
    width: max(calc(100% - 0.5rem), 11.5rem);
    max-width: min(40rem, calc(100vw - 0.5rem));
    /* Stay beside the image's lower edge. Use letterbox space first, then
       overlap only as much of the image as the available height requires. */
    top: max(
        0px,
        min(calc(var(--preview-bottom) + 4px), calc(100% - var(--transport-height) - 4px))
    );
}

.transport-time {
    display: none;
}

.transport-button {
    @apply flex h-9 min-w-0 items-center justify-center rounded-full bg-button px-px shadow-md transition-colors hover:shadow-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fg active:bg-accent active:text-on-accent;
}

.transport-button.is-held {
    @apply bg-accent text-on-accent;
}

@container (max-width: 18.9375rem) {
    .preview-transport {
        --transport-height: 5.125rem;
    }

    .transport-steps {
        grid-template-columns: repeat(3, minmax(0, 1fr));
    }
}

@container (min-width: 32rem) {
    .preview-transport {
        grid-template-columns: 2.25rem auto minmax(0, 1fr);
    }

    .transport-time {
        display: block;
    }

    .transport-corner-time {
        display: none;
    }
}
</style>
