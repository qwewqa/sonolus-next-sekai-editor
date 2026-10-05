<script setup lang="ts">
import { computed, nextTick, useId, useTemplateRef, watch } from 'vue'
import PlayIcon from '../editor/commands/play/PlayIcon.vue'
import { togglePreviewPlayback } from '../editor/player'
import { view } from '../editor/view'
import ChevronIcon from '../editor/workspace/ChevronIcon.vue'
import { isPlaying } from '../player'
import { i18n } from '../i18n'
import { settings } from '../settings'
import { formatTime } from '../utils/format'
import { interpolateRaw } from '../utils/interpolate'
import type { PreviewControlsLayout } from './layout'
import { useTransportInput } from './useTransportInput'
import { isCoarsePointer, settingsButtonSize } from './usePreviewViewport'

const props = defineProps<{
    layout: PreviewControlsLayout
}>()
const emit = defineEmits<{
    timeResize: [width: number, height: number]
}>()
const visible = defineModel<boolean>({ required: true })
const panelId = useId()
const toggle = useTemplateRef<HTMLButtonElement>('toggle')
const cornerTime = useTemplateRef<HTMLSpanElement>('cornerTime')

// The strip has its own place below the image; otherwise it shows
// over the image's lower edge on demand.
const persistent = computed(() => props.layout.placement !== 'overlay')
const timeInStrip = computed(() => settings.previewShowTime && props.layout.timeInStrip)
const timeInCorner = computed(() => settings.previewShowTime && !props.layout.timeInStrip)

const formattedTime = computed(() => formatTime(Math.round(view.cursorTime * 1000) / 1000))

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
    if (persistent.value) return
    cancel()
    visible.value = !visible.value
    blurPointerButton(event)
}

const hide = (event: MouseEvent | KeyboardEvent) => {
    cancel()
    if (persistent.value) {
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

const stepSizes = [1, 10, 100] as const
const cycleStepSize = (event: MouseEvent) => {
    const index = stepSizes.indexOf(settings.previewStepSize)
    settings.previewStepSize = stepSizes[(index + 1) % stepSizes.length] ?? 10
    blurPointerButton(event)
}
const stepSizeLabel = computed(() =>
    interpolateRaw(i18n.value.preview.transport.stepSize, `${settings.previewStepSize}`),
)

const stepLabel = (step: number) =>
    interpolateRaw(
        step < 0 ? i18n.value.preview.transport.back : i18n.value.preview.transport.forward,
        `${Math.abs(step)}`,
    )
const stepTitle = (step: number) =>
    `${stepLabel(step)}. ${interpolateRaw(
        step < 0
            ? i18n.value.preview.transport.holdBackward
            : i18n.value.preview.transport.holdForward,
        `${Math.abs(step) / 10}`,
    )}`

const steps = [-100, -10, -1, 1, 10, 100]

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
    observer.observe(element, { box: 'border-box' })
    update()
    onCleanup(() => {
        observer.disconnect()
    })
})

const stripStyle = computed(() => ({
    left: `${props.layout.strip.left}px`,
    top: `${props.layout.strip.top}px`,
    width: `${props.layout.strip.width}px`,
    height: `${props.layout.strip.height}px`,
}))
</script>

<template>
    <div
        class="preview-transport-root pointer-events-auto absolute inset-0 z-10"
        :class="{ 'is-coarse': isCoarsePointer }"
        @wheel="onWheel"
    >
        <button
            v-if="!persistent"
            ref="toggle"
            type="button"
            class="preview-transport-toggle pointer-events-auto absolute inset-0 h-full w-full touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
            :aria-label="visible ? i18n.preview.transport.hide : i18n.preview.transport.show"
            :title="visible ? i18n.preview.transport.hide : i18n.preview.transport.show"
            :aria-expanded="visible"
            :aria-controls="panelId"
            @click.stop="toggleVisibility"
            @keydown.stop
        />
        <!-- Without room in the strip, the time sits in the image's top-left
        corner, centered on the line of the settings toggle in the other corner. -->
        <span
            v-if="timeInCorner"
            ref="cornerTime"
            class="transport-corner-time pointer-events-none absolute z-10 -translate-y-1/2 rounded-full bg-modal px-1.5 py-0.5 text-xs tabular-nums text-fg shadow-md"
            :style="{
                left: `${layout.canvas.left + 4}px`,
                top: `${layout.canvas.top + 4 + settingsButtonSize / 2}px`,
            }"
            :aria-label="i18n.preview.transport.time"
        >
            {{ formattedTime }}
        </span>
        <div
            :id="panelId"
            class="preview-transport absolute z-20 flex items-center gap-1 rounded-full bg-modal p-1 text-fg shadow-xl ring-1 ring-fg/10"
            :class="[
                `is-${layout.mode}`,
                visible ? 'pointer-events-auto' : 'pointer-events-none invisible',
            ]"
            :style="stripStyle"
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
                class="transport-button transport-play"
                :aria-label="isPlaying ? i18n.preview.transport.pause : i18n.preview.transport.play"
                :title="isPlaying ? i18n.preview.transport.pause : i18n.preview.transport.play"
                @click="play"
            >
                <PlayIcon :state="isPlaying" class="size-4 fill-current" aria-hidden="true" />
            </button>

            <span
                v-if="timeInStrip"
                class="transport-time"
                :aria-label="i18n.preview.transport.time"
            >
                {{ formattedTime }}
            </span>

            <span v-if="layout.mode === 'steps'" class="transport-track transport-steps">
                <button
                    v-for="step in steps"
                    :key="step"
                    type="button"
                    class="transport-button transport-step touch-none select-none tabular-nums"
                    :class="{ 'is-held': activeStep === step }"
                    :aria-label="stepLabel(step)"
                    :title="stepTitle(step)"
                    @pointerdown="onPointerDown($event, step)"
                    @pointerup="onPointerUp"
                    @pointercancel="onPointerCancel"
                    @lostpointercapture="onPointerCancel"
                    @keydown="onStepKeydown($event, step)"
                    @keyup="onStepKeyup"
                    @blur="onStepBlur"
                    @click.prevent="onStepClick($event, step)"
                >
                    {{ step < 0 ? '−' : '+' }}{{ Math.abs(step) }}
                </button>
            </span>

            <span v-else class="transport-track transport-compact">
                <button
                    v-for="step in [-settings.previewStepSize]"
                    :key="step"
                    type="button"
                    class="transport-button transport-chevron touch-none select-none"
                    :class="{ 'is-held': activeStep === step }"
                    :aria-label="stepLabel(step)"
                    :title="stepTitle(step)"
                    @pointerdown="onPointerDown($event, step)"
                    @pointerup="onPointerUp"
                    @pointercancel="onPointerCancel"
                    @lostpointercapture="onPointerCancel"
                    @keydown="onStepKeydown($event, step)"
                    @keyup="onStepKeyup"
                    @blur="onStepBlur"
                    @click.prevent="onStepClick($event, step)"
                >
                    <ChevronIcon direction="left" />
                </button>
                <button
                    type="button"
                    class="transport-button transport-size tabular-nums"
                    :aria-label="stepSizeLabel"
                    :title="stepSizeLabel"
                    @click="cycleStepSize"
                >
                    {{ settings.previewStepSize }}<span class="ml-px">ms</span>
                </button>
                <button
                    v-for="step in [settings.previewStepSize]"
                    :key="step"
                    type="button"
                    class="transport-button transport-chevron touch-none select-none"
                    :class="{ 'is-held': activeStep === step }"
                    :aria-label="stepLabel(step)"
                    :title="stepTitle(step)"
                    @pointerdown="onPointerDown($event, step)"
                    @pointerup="onPointerUp"
                    @pointercancel="onPointerCancel"
                    @lostpointercapture="onPointerCancel"
                    @keydown="onStepKeydown($event, step)"
                    @keyup="onStepKeyup"
                    @blur="onStepBlur"
                    @click.prevent="onStepClick($event, step)"
                >
                    <ChevronIcon direction="right" />
                </button>
            </span>
        </div>
    </div>
</template>

<style scoped>
.transport-button {
    @apply flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-button text-xs shadow-md transition-colors hover:shadow-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fg active:bg-accent active:text-on-accent;
}

.transport-button.is-held {
    @apply bg-accent text-on-accent;
}

/* The time follows Play; it is Meta text and keeps its width as it changes. */
.transport-time {
    @apply min-w-16 shrink-0 px-1 text-xs tabular-nums text-fg;
}

/* Steppers share a recessed track, like a segmented control, filling the rest
   of the strip up to a comfortable size. */
.transport-track {
    @apply flex min-w-0 flex-1 items-center gap-0.5 rounded-full bg-fg/10 p-0.5 shadow-track;
}

.transport-steps {
    max-width: calc(6 * 4rem + 5 * 2px + 4px);
}

.transport-compact {
    max-width: calc(2 * 4rem + 3rem + 2 * 2px + 4px);
    margin-left: auto;
}

.transport-step,
.transport-chevron {
    flex: 1 1 0;
    width: auto;
    min-width: 2rem;
    max-width: 4rem;
}

.transport-chevron {
    min-width: 2.25rem;
}

.transport-size {
    width: 3rem;
}

/* Touch: Play, the frequent control, is 44 px in a 52 px strip; the steppers,
   used less often, are 40 px. */
.is-coarse .transport-play {
    @apply h-11 w-11;
}

.is-coarse .transport-track .transport-button {
    @apply h-10;
}

.is-coarse .transport-step,
.is-coarse .transport-chevron {
    width: auto;
    min-width: 2.5rem;
}
</style>
