import type { Directive } from 'vue'

/**
 * Marks which ends of a scroll container have more content beyond them, so
 * CSS can fade those edges (see `.scroll-edges` in `src/index.css`). The fade
 * adds no size or padding and never intercepts pointer events.
 *
 * Usage: `v-scroll-edges` (vertical), `v-scroll-edges:x` (horizontal), and the
 * `.end` modifier to fade only the far end, for containers whose first child
 * is a sticky header that must stay crisp.
 */
type State = {
    horizontal: boolean
    schedule: () => void
    resize: ResizeObserver
    mutation: MutationObserver
}

const states = new WeakMap<HTMLElement, State>()

const measure = (element: HTMLElement, horizontal: boolean) => {
    const position = horizontal ? element.scrollLeft : element.scrollTop
    const size = horizontal ? element.clientWidth : element.clientHeight
    const content = horizontal ? element.scrollWidth : element.scrollHeight
    return { before: position > 1, after: position + size < content - 1 }
}

const apply = (element: HTMLElement, edges: { before: boolean; after: boolean }) => {
    element.toggleAttribute('data-scroll-before', edges.before)
    element.toggleAttribute('data-scroll-after', edges.after)
}

// Updates from component patches, observers, and scrolling wait for the next
// frame, where every container is measured before any is marked. Measuring
// each one as soon as it changed forced a layout per container whenever a
// panel resized or re-rendered. The marks only change a mask, never layout.
const pending = new Set<HTMLElement>()
let frame = 0

const flush = () => {
    frame = 0
    const elements = [...pending]
    pending.clear()
    const edges = elements.map((element) => {
        const state = states.get(element)
        return state && measure(element, state.horizontal)
    })
    elements.forEach((element, index) => {
        const value = edges[index]
        if (value) apply(element, value)
    })
}

export const vScrollEdges: Directive<HTMLElement> = {
    mounted(element, binding) {
        const horizontal = binding.arg === 'x'
        element.classList.add('scroll-edges')
        element.dataset.scrollAxis = horizontal ? 'x' : 'y'
        if (binding.modifiers.end) element.dataset.scrollEndOnly = ''

        const schedule = () => {
            pending.add(element)
            frame ||= requestAnimationFrame(flush)
        }

        // Children are observed too: content can grow inside a fixed-size box.
        const resize = new ResizeObserver(schedule)
        const observeChildren = () => {
            resize.disconnect()
            resize.observe(element)
            for (const child of element.children) resize.observe(child)
            schedule()
        }
        const mutation = new MutationObserver(observeChildren)
        mutation.observe(element, { childList: true })
        resize.observe(element)
        for (const child of element.children) resize.observe(child)
        element.addEventListener('scroll', schedule, { passive: true })

        states.set(element, { horizontal, schedule, resize, mutation })
        // The first marks are applied right away, so content never shows unfaded.
        apply(element, measure(element, horizontal))
    },
    updated(element) {
        states.get(element)?.schedule()
    },
    unmounted(element) {
        const state = states.get(element)
        if (!state) return
        element.removeEventListener('scroll', state.schedule)
        state.resize.disconnect()
        state.mutation.disconnect()
        states.delete(element)
        pending.delete(element)
    },
}
