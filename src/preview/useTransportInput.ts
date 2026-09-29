import { onUnmounted, ref, watch, type Ref } from 'vue'
import { isAppActive } from '../activity'
import {
    beginPreviewScrub,
    endPreviewScrub,
    scrubPreviewTo,
    stepPreviewTime,
} from '../editor/player'
import { view } from '../editor/view'
import { isPlaying } from '../player'
import { time } from '../time'

export const useTransportInput = (visible: Ref<boolean>) => {
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
        if (hold?.type === 'keyboard') finishHold(false)
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
    return {
        activeStep,
        onWheel,
        onPointerDown,
        onPointerUp,
        onPointerCancel,
        onStepKeydown,
        onStepKeyup,
        onStepBlur,
        onStepClick,
        cancel: () => {
            finishHold(false)
            finishWheel(false)
        },
    }
}
