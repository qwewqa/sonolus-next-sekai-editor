<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, useId, useTemplateRef, watch } from 'vue'
import { isAppActive } from '../activity'
import PlayIcon from '../editor/commands/play/PlayIcon.vue'
import {
    beginPreviewScrub,
    endPreviewScrub,
    scrubPreviewTo,
    stepPreviewTime,
    togglePreviewPlayback,
} from '../editor/player'
import { view } from '../editor/view'
import { isPlaying } from '../player'
import { time } from '../time'
import { formatTime } from '../utils/format'

const props = defineProps<{ viewportBottom: number; persistent: boolean }>()
const emit = defineEmits<{ resize: [height: number, width: number] }>()
const visible = defineModel<boolean>({ required: true })
const panelId = useId()
const panel = useTemplateRef<HTMLDivElement>('panel')
const toggle = useTemplateRef<HTMLButtonElement>('toggle')
const position = computed(() =>
    visible.value || !isPlaying.value ? formatTime(Math.round(view.cursorTime * 1000) / 1000) : '',
)
const activeStep = ref<number>()

type Hold = {
    milliseconds: number
    target: HTMLButtonElement
    scrub?: { cursor: number; time: number }
} & ({ type: 'pointer'; pointerId: number } | { type: 'keyboard'; key: string })

let hold: Hold | undefined
let holdDelay: ReturnType<typeof setTimeout> | undefined
let stopScrubClock: (() => void) | undefined
let wheelDelay: ReturnType<typeof setTimeout> | undefined
let isWheelScrubbing = false
let wheelRoot: HTMLElement | undefined

const finishHold = (audition: boolean) => {
    const current = hold
    if (!current) return
    hold = undefined
    activeStep.value = undefined
    clearTimeout(holdDelay)
    holdDelay = undefined
    stopScrubClock?.()
    stopScrubClock = undefined
    if (current.scrub) endPreviewScrub(audition && isAppActive.value)
    if (current.type === 'pointer') {
        if (current.target.hasPointerCapture(current.pointerId)) {
            current.target.releasePointerCapture(current.pointerId)
        }
        current.target.blur()
    }
}

const finishWheel = (audition: boolean) => {
    clearTimeout(wheelDelay)
    wheelDelay = undefined
    document.removeEventListener('pointerdown', onWheelOutsidePointerDown, true)
    wheelRoot = undefined
    if (!isWheelScrubbing) return
    isWheelScrubbing = false
    endPreviewScrub(audition && isAppActive.value)
}

const onWheelOutsidePointerDown = (event: PointerEvent) => {
    if (event.target instanceof Node && !wheelRoot?.contains(event.target)) finishWheel(false)
}

const onWheel = (event: WheelEvent) => {
    // Firefox can change legacy wheel units when deltaY is accessed first.
    const mode = event.deltaMode
    const delta = event.deltaY
    if (event.ctrlKey || !isAppActive.value || !Number.isFinite(delta) || !delta) return

    const pixels =
        delta *
        (mode === WheelEvent.DOM_DELTA_LINE
            ? 16
            : mode === WheelEvent.DOM_DELTA_PAGE
              ? (event.currentTarget as HTMLElement).clientHeight
              : 1)
    event.preventDefault()
    event.stopPropagation()
    finishHold(false)
    if (!isWheelScrubbing) {
        beginPreviewScrub('locked')
        isWheelScrubbing = true
        wheelRoot = event.currentTarget as HTMLElement
        // A subsequent editor click must retain its normal note audition.
        document.addEventListener('pointerdown', onWheelOutsidePointerDown, true)
    }
    scrubPreviewTo(view.cursorTime - pixels / 1000)
    // Trackpads can emit several events per frame. Keep them silent and audition
    // only the final position after the gesture settles.
    clearTimeout(wheelDelay)
    wheelDelay = setTimeout(() => {
        finishWheel(true)
    }, 120)
}

const startHold = (current: Hold) => {
    if (hold || !isAppActive.value) return false
    finishWheel(false)
    stepPreviewTime(current.milliseconds)
    hold = current
    activeStep.value = current.milliseconds
    // A short tap remains one exact step. Holding then scrubs at 100 steps/s,
    // using elapsed time instead of an interval or a backlog of repeated taps.
    holdDelay = setTimeout(() => {
        holdDelay = undefined
        if (hold !== current || !isAppActive.value) return
        beginPreviewScrub('locked')
        current.scrub = { cursor: view.cursorTime, time: performance.now() / 1000 }
        stopScrubClock = watch(time, ({ now }) => {
            if (hold !== current || !current.scrub) return
            scrubPreviewTo(
                current.scrub.cursor +
                    (Math.max(0, now - current.scrub.time) * current.milliseconds) / 10,
            )
        })
    }, 250)
    return true
}

const onPointerDown = (event: PointerEvent, milliseconds: number) => {
    if (event.button !== 0 || !event.isPrimary) return
    const target = event.currentTarget as HTMLButtonElement
    if (startHold({ type: 'pointer', pointerId: event.pointerId, target, milliseconds })) {
        target.setPointerCapture(event.pointerId)
    }
}

const onPointerUp = (event: PointerEvent) => {
    if (hold?.type === 'pointer' && hold.pointerId === event.pointerId) finishHold(true)
}

const onPointerCancel = (event: PointerEvent) => {
    if (hold?.type === 'pointer' && hold.pointerId === event.pointerId) finishHold(false)
}

const onStepKeydown = (event: KeyboardEvent, milliseconds: number) => {
    if (event.key !== ' ' && event.key !== 'Enter') return
    event.preventDefault()
    if (event.repeat) return
    startHold({
        type: 'keyboard',
        key: event.key,
        target: event.currentTarget as HTMLButtonElement,
        milliseconds,
    })
}

const onStepKeyup = (event: KeyboardEvent) => {
    if (event.key !== ' ' && event.key !== 'Enter') return
    event.preventDefault()
    if (hold?.type === 'keyboard' && hold.key === event.key) finishHold(true)
}

const onStepBlur = (event: FocusEvent) => {
    if (hold?.type === 'keyboard' && hold.target === event.currentTarget) finishHold(false)
}

const onStepClick = (event: MouseEvent, milliseconds: number) => {
    // Pointer and keyboard presses are handled above. Assistive technology can
    // activate a button with a click alone and still gets one exact step.
    if (!event.detail && !hold) {
        finishWheel(false)
        stepPreviewTime(milliseconds)
    }
}

const blurPointerButton = (event: MouseEvent) => {
    if (event.detail) (event.currentTarget as HTMLButtonElement).blur()
}

const toggleVisibility = (event: MouseEvent) => {
    if (props.persistent) return
    finishHold(false)
    finishWheel(false)
    visible.value = !visible.value
    blurPointerButton(event)
}

const hide = (event: MouseEvent | KeyboardEvent) => {
    finishHold(false)
    finishWheel(false)
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
    finishHold(false)
    finishWheel(false)
    togglePreviewPlayback()
    blurPointerButton(event)
}

watch(
    panel,
    (element, _previous, onCleanup) => {
        if (!element) {
            emit('resize', 0, 0)
            return
        }
        const root = element.parentElement
        if (!root) return
        let height = -1
        let width = -1
        const update = () => {
            const nextHeight = element.getBoundingClientRect().height
            const nextWidth = root.getBoundingClientRect().width
            if (nextHeight === height && nextWidth === width) return
            height = nextHeight
            width = nextWidth
            emit('resize', height, width)
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

watch(
    [visible, isPlaying, isAppActive],
    ([shown, playing, active], [wasShown]) => {
        if (!shown || playing || !active) finishHold(false)
        // Seeking also works with the controls hidden. Only a transition to
        // hidden, playback, or backgrounding cancels an active wheel gesture.
        if ((wasShown && !shown) || playing || !active) finishWheel(false)
    },
    { flush: 'sync' },
)

onUnmounted(() => {
    finishHold(false)
    finishWheel(false)
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
            class="preview-transport-toggle pointer-events-auto absolute inset-0 h-full w-full touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/75"
            :aria-label="visible ? 'Hide playback controls' : 'Show playback controls'"
            :aria-expanded="visible"
            :aria-controls="panelId"
            @click.stop="toggleVisibility"
            @keydown.stop
        />
        <span
            v-if="!isPlaying"
            class="transport-corner-time pointer-events-none absolute left-1 top-1 z-10 rounded bg-black/40 px-1 py-0.5 font-mono text-[10px] tabular-nums leading-4 text-white/80"
            aria-label="Preview time"
        >
            {{ position }}
        </span>
        <div
            :id="panelId"
            ref="panel"
            class="preview-transport absolute z-20 grid items-center gap-1 rounded bg-black/80 p-1 text-white/90"
            :class="visible ? 'pointer-events-auto' : 'pointer-events-none invisible'"
            :inert="!visible"
            :aria-hidden="!visible"
            role="group"
            aria-label="Preview playback controls"
            @click.stop
            @keydown.stop
            @keydown.esc.prevent="hide"
            @pointerdown.stop
            @contextmenu.prevent
        >
            <button
                type="button"
                class="transport-button"
                :aria-label="isPlaying ? 'Pause preview' : 'Play preview'"
                :title="isPlaying ? 'Pause preview' : 'Play preview'"
                @click="play"
            >
                <PlayIcon :state="isPlaying" class="size-4 fill-current" aria-hidden="true" />
            </button>
            <span
                class="transport-time px-1 text-center font-mono text-xs tabular-nums"
                aria-label="Preview time"
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
                    :aria-label="`${step < 0 ? 'Back' : 'Forward'} ${Math.abs(step)} ms`"
                    :title="`Hold for ${Math.abs(step) / 10}× ${step < 0 ? 'backward' : 'forward'}`"
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
                    <span class="text-[9px] leading-3 text-white/60" aria-hidden="true">ms</span>
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
    @apply flex h-9 min-w-0 items-center justify-center rounded bg-white/10 px-px hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/75;
}

.transport-button.is-held {
    @apply bg-white/30;
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
