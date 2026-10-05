import { onBeforeUnmount, onMounted, onUnmounted, toValue, watch, type MaybeRefOrGetter } from 'vue'

type ScrollPosition = { top: number; left: number }

// Panels unmount when they are covered or closed, so positions live outside
// any component for the rest of the session.
const positions = new Map<string, ScrollPosition>()

/** Whether a position is remembered under `key`. */
export const hasScrollMemory = (key: string | undefined) => key !== undefined && positions.has(key)

/**
 * Remembers an element's scroll position under `key` and restores it when the
 * element is mounted again or the key changes (e.g. switching sections in one
 * scroller). Without a key, nothing is remembered.
 */
export const useScrollMemory = (
    key: MaybeRefOrGetter<string | undefined>,
    target: MaybeRefOrGetter<HTMLElement | null | undefined>,
) => {
    let frame: number | undefined
    let restoring: ScrollPosition | undefined
    let mounted = false

    const record = (name: string | undefined, element: HTMLElement | null | undefined) => {
        if (name && element && !restoring)
            positions.set(name, { top: element.scrollTop, left: element.scrollLeft })
    }

    const save = (event: Event) => {
        const element = event.currentTarget as HTMLElement
        // Ignore the clamped position reported while restoring into content
        // that has not grown to its full size yet.
        if (restoring && (element.scrollTop < restoring.top || element.scrollLeft < restoring.left))
            return
        restoring = undefined
        record(toValue(key), element)
    }

    const restore = (element: HTMLElement, reset: boolean) => {
        const name = toValue(key)
        const position =
            (name === undefined ? undefined : positions.get(name)) ??
            (reset ? { top: 0, left: 0 } : undefined)
        if (!position) return
        restoring = position
        element.scrollTop = position.top
        element.scrollLeft = position.left
        // Layout may still settle after mount, for example when a dock size is
        // applied; try once more on the next frame.
        if (frame !== undefined) cancelAnimationFrame(frame)
        frame = requestAnimationFrame(() => {
            frame = undefined
            if (!element.isConnected || restoring !== position) return
            element.scrollTop = position.top
            element.scrollLeft = position.left
            restoring = undefined
        })
    }

    onMounted(() => {
        mounted = true
        const element = toValue(target)
        if (element) restore(element, false)
    })

    watch(
        () => toValue(target),
        (element, _, onCleanup) => {
            if (!element) return
            element.addEventListener('scroll', save, { passive: true })
            onCleanup(() => {
                element.removeEventListener('scroll', save)
            })
            // An element that appears after mount (e.g. a list replacing an
            // empty state) restores too.
            if (mounted) restore(element, false)
        },
        { immediate: true, flush: 'post' },
    )

    // A new key usually comes with new content: record the old position before
    // the content changes, then show the new key's position afterwards.
    watch(
        () => toValue(key),
        (_, previous) => {
            record(previous, toValue(target))
        },
        { flush: 'pre' },
    )
    watch(
        () => toValue(key),
        () => {
            const element = toValue(target)
            if (element && mounted) restore(element, true)
        },
        { flush: 'post' },
    )

    // Scroll events arrive a frame late; record the final position directly.
    onBeforeUnmount(() => {
        record(toValue(key), toValue(target))
    })

    onUnmounted(() => {
        if (frame !== undefined) cancelAnimationFrame(frame)
    })
}
