// Events a press goes on to fire after its pointerdown, which nothing under it may see.
const follows = [
    'pointermove',
    'pointerup',
    'pointercancel',
    'mousedown',
    'mouseup',
    'click',
    'dblclick',
    'auxclick',
    'contextmenu',
    'touchstart',
    'touchmove',
    'touchend',
    'touchcancel',
] as const

// How long a released press may still fire its click or context menu; a tap's come late.
const trail = 1000

let release: (() => void) | undefined

/** Keeps the rest of a press from reaching anything, as one that only dismisses must. */
export const swallowPress = (event: PointerEvent) => {
    event.preventDefault()
    event.stopImmediatePropagation()
    release?.()
    const { pointerId } = event
    let released = false
    let timer = 0
    const stop = (next: Event) => {
        if (next instanceof PointerEvent && next.type !== 'click' && next.pointerId !== pointerId)
            return
        // A keyboard's click is a new action; once released, moves are hovers again.
        if (next.type === 'click' && (next as MouseEvent).detail === 0) return
        if (released && next.type.endsWith('move')) return
        next.preventDefault()
        next.stopImmediatePropagation()
        if (!released && (next.type === 'pointerup' || next.type === 'pointercancel')) {
            released = true
            timer = window.setTimeout(end, trail)
        }
    }
    // The next press is the user's own.
    const onPointerDown = (next: PointerEvent) => {
        if (next !== event) end()
    }
    const end = () => {
        clearTimeout(timer)
        for (const type of follows) window.removeEventListener(type, stop, true)
        window.removeEventListener('pointerdown', onPointerDown, true)
        if (release === end) release = undefined
    }
    for (const type of follows)
        window.addEventListener(type, stop, { capture: true, passive: false })
    window.addEventListener('pointerdown', onPointerDown, true)
    release = end
}
