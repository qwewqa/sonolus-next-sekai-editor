<script setup lang="ts">
import { onBeforeUnmount, shallowRef, useTemplateRef, watch } from 'vue'

/**
 * A thin scrollbar drawn over the right edge of `target`, which hides its own
 * (see `.overlay-scroller` in `src/index.css`) and so reserves no gutter. It
 * shows while scrolling and while a mouse or pen is near the edge, then fades.
 * Only the thumb takes pointer events, and only while edge-hovered or dragged,
 * so a bar shown by scrolling never takes a click meant for the content beneath. Forced colors
 * keep the native scrollbar instead. While `target` overflows it carries
 * `data-scrollable`, so its content can keep clear of the bar.
 *
 * Place it in a positioned element that holds `target`.
 */
const props = defineProps<{
    target: HTMLElement | null | undefined
}>()

const strip = useTemplateRef<HTMLElement>('strip')

// Room at the edge that reveals the bar and takes its clicks.
const edge = 10
const inset = 2
const minThumb = 24
const hideDelay = 1000

const forcedColorsQuery = matchMedia('(forced-colors: active)')
const forcedColors = shallowRef(forcedColorsQuery.matches)
const onForcedColors = () => {
    forcedColors.value = forcedColorsQuery.matches
}
forcedColorsQuery.addEventListener('change', onForcedColors)

const box = shallowRef({ top: 0, left: 0, height: 0 })
const thumb = shallowRef({ top: 0, height: 0 })
const overflowing = shallowRef(false)
const shown = shallowRef(false)
const hovered = shallowRef(false)
const dragging = shallowRef(false)

let hideTimer: ReturnType<typeof setTimeout> | undefined
let frame = 0

const scheduleHide = () => {
    clearTimeout(hideTimer)
    hideTimer = setTimeout(() => {
        if (!hovered.value && !dragging.value) shown.value = false
    }, hideDelay)
}

const reveal = () => {
    if (!overflowing.value) return
    shown.value = true
    scheduleHide()
}

const measure = () => {
    frame = 0
    const element = props.target
    const host = strip.value?.offsetParent
    if (!element || !host) return
    const { clientHeight, scrollHeight, scrollTop } = element
    overflowing.value = scrollHeight > clientHeight + 1
    // Lets content make room for the bar only while it can show.
    element.toggleAttribute('data-scrollable', overflowing.value)
    if (!overflowing.value) {
        shown.value = false
        hovered.value = false
        return
    }
    const rect = element.getBoundingClientRect()
    const parent = host.getBoundingClientRect()
    box.value = {
        top: rect.top - parent.top - host.clientTop,
        left: rect.right - edge - parent.left - host.clientLeft,
        height: clientHeight,
    }
    const track = clientHeight - inset * 2
    const height = Math.min(track, Math.max(minThumb, (track * clientHeight) / scrollHeight))
    const range = scrollHeight - clientHeight
    thumb.value = {
        top: inset + ((track - height) * Math.min(scrollTop, range)) / range,
        height,
    }
}

const schedule = () => {
    frame ||= requestAnimationFrame(measure)
}

const onScroll = () => {
    measure()
    reveal()
}

// Hovering is tracked on the bar's parent, which holds the scroller too, so
// moving onto the bar itself keeps it.
const nearEdge = (event: PointerEvent) => {
    const rect = strip.value?.getBoundingClientRect()
    if (!rect || event.pointerType === 'touch') return false
    return (
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom &&
        event.clientX >= rect.left &&
        event.clientX <= rect.right
    )
}

const control = 'button, a, input, select, textarea, label, [role="button"], [tabindex]'

// Whether a control beside the bar lies under the pointer, looking past the
// thumb; a focusable host around it, such as a dialog, is not one.
const overControl = (event: PointerEvent) => {
    const host = strip.value?.parentElement
    const hit = document
        .elementsFromPoint(event.clientX, event.clientY)
        .find((element) => !strip.value?.contains(element))
        ?.closest(control)
    return !!hit && !!host && hit !== host && host.contains(hit)
}

const onPointerMove = (event: PointerEvent) => {
    // A press that started elsewhere, such as selecting text, passes over it,
    // and a control beneath keeps its clicks.
    const near =
        overflowing.value &&
        nearEdge(event) &&
        (hovered.value || !event.buttons) &&
        !overControl(event)
    if (near === hovered.value) return
    hovered.value = near
    if (near) {
        measure()
        shown.value = true
    } else scheduleHide()
}

const onPointerLeave = () => {
    if (!hovered.value) return
    hovered.value = false
    scheduleHide()
}

let drag: { pointer: number; y: number; scrollTop: number } | undefined

const onThumbDown = (event: PointerEvent) => {
    const element = props.target
    if (!element || event.button !== 0) return
    // Keeps focus where it is and the press from reaching panel handlers.
    event.preventDefault()
    event.stopPropagation()
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
    drag = { pointer: event.pointerId, y: event.clientY, scrollTop: element.scrollTop }
    dragging.value = true
    shown.value = true
}

const onThumbMove = (event: PointerEvent) => {
    const element = props.target
    if (!element || drag?.pointer !== event.pointerId) return
    const travel = element.clientHeight - inset * 2 - thumb.value.height
    if (travel <= 0) return
    element.scrollTop =
        drag.scrollTop +
        ((event.clientY - drag.y) * (element.scrollHeight - element.clientHeight)) / travel
}

const onThumbUp = (event: PointerEvent) => {
    if (drag?.pointer !== event.pointerId) return
    drag = undefined
    dragging.value = false
    scheduleHide()
}

// A click on the hovered track pages toward it, as a native track does, unless
// it lands on a control beneath.
const onTrackDown = (event: PointerEvent) => {
    const element = props.target
    if (!element || event.button !== 0 || !hovered.value || !nearEdge(event)) return
    const target = event.target instanceof Element ? event.target : null
    if (target?.closest('.overlay-scrollbar-thumb') || overControl(event)) return
    event.preventDefault()
    event.stopPropagation()
    const y = event.clientY - element.getBoundingClientRect().top
    const direction = y < thumb.value.top ? -1 : y > thumb.value.top + thumb.value.height ? 1 : 0
    element.scrollBy({ top: direction * element.clientHeight * 0.875 })
}

// The bar is not inside the scroller, so wheeling over it scrolls it on.
const onWheel = (event: WheelEvent) => {
    const element = props.target
    if (!element || event.ctrlKey) return
    event.preventDefault()
    const scale =
        event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? element.clientHeight
            : event.deltaMode === WheelEvent.DOM_DELTA_LINE
              ? 16
              : 1
    element.scrollBy({ top: event.deltaY * scale })
}

const listen = (element: HTMLElement) => {
    const resize = new ResizeObserver(schedule)
    const observeChildren = () => {
        resize.disconnect()
        resize.observe(element)
        for (const child of element.children) resize.observe(child)
        schedule()
    }
    const mutation = new MutationObserver(observeChildren)
    mutation.observe(element, { childList: true })
    observeChildren()
    const parent = strip.value?.parentElement
    element.addEventListener('scroll', onScroll, { passive: true })
    parent?.addEventListener('pointermove', onPointerMove, { passive: true })
    parent?.addEventListener('pointerleave', onPointerLeave, { passive: true })
    parent?.addEventListener('pointerdown', onTrackDown, true)
    return () => {
        resize.disconnect()
        mutation.disconnect()
        element.removeEventListener('scroll', onScroll)
        parent?.removeEventListener('pointermove', onPointerMove)
        parent?.removeEventListener('pointerleave', onPointerLeave)
        parent?.removeEventListener('pointerdown', onTrackDown, true)
    }
}

watch(
    [() => props.target, forcedColors],
    ([element, forced], _, onCleanup) => {
        shown.value = false
        hovered.value = false
        if (!element || forced) return
        const stop = listen(element)
        onCleanup(() => {
            stop()
            element.removeAttribute('data-scrollable')
        })
    },
    { flush: 'post', immediate: true },
)

onBeforeUnmount(() => {
    clearTimeout(hideTimer)
    cancelAnimationFrame(frame)
    forcedColorsQuery.removeEventListener('change', onForcedColors)
})
</script>

<template>
    <div
        v-if="!forcedColors"
        ref="strip"
        class="overlay-scrollbar"
        :class="{
            'overlay-scrollbar-shown': shown && overflowing,
            'overlay-scrollbar-active': (hovered || dragging) && overflowing,
            'overlay-scrollbar-dragging': dragging,
        }"
        :style="{
            top: `${box.top}px`,
            left: `${box.left}px`,
            height: `${box.height}px`,
            width: `${edge}px`,
        }"
        aria-hidden="true"
        @wheel="onWheel"
    >
        <div
            class="overlay-scrollbar-thumb"
            :style="{ top: `${thumb.top}px`, height: `${thumb.height}px` }"
            @pointerdown="onThumbDown"
            @pointermove="onThumbMove"
            @pointerup="onThumbUp"
            @pointercancel="onThumbUp"
            @lostpointercapture="onThumbUp"
        />
    </div>
</template>

<style scoped>
/* A dock can ask for room at the edge, as a left dock does for its resize handle. */
.overlay-scrollbar {
    position: absolute;
    translate: calc(-1 * var(--overlay-scrollbar-inset, 0px)) 0;
    z-index: 20;
    pointer-events: none;
    opacity: 0;
    transition: opacity 300ms ease;
}

.overlay-scrollbar-shown {
    opacity: 1;
    transition-duration: 100ms;
}

/* The thumb spans the strip; only one the pointer came to takes clicks. */
.overlay-scrollbar-thumb {
    position: absolute;
    left: 0;
    right: 0;
}

.overlay-scrollbar-active .overlay-scrollbar-thumb {
    pointer-events: auto;
}

.overlay-scrollbar-thumb::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    right: 2px;
    width: 4px;
    border-radius: 9999px;
    @apply bg-fg/40;
    transition:
        width 100ms ease,
        background-color 100ms ease;
}

.overlay-scrollbar-active .overlay-scrollbar-thumb::after {
    width: 6px;
    @apply bg-fg/55;
}

.overlay-scrollbar-dragging .overlay-scrollbar-thumb::after {
    @apply bg-fg/70;
}

@media (prefers-reduced-motion: reduce) {
    .overlay-scrollbar,
    .overlay-scrollbar-thumb::after {
        transition: none;
    }
}
</style>
