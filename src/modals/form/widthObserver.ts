// One ResizeObserver for every field, calling back when an element's width changes.
const callbacks = new WeakMap<Element, { width: number; callback: () => void }>()
let observer: ResizeObserver | undefined

export const observeWidth = (element: Element, callback: () => void) => {
    observer ??= new ResizeObserver((entries) => {
        for (const entry of entries) {
            const target = callbacks.get(entry.target)
            if (!target || entry.contentRect.width === target.width) continue
            target.width = entry.contentRect.width
            target.callback()
        }
    })
    callbacks.set(element, { width: element.getBoundingClientRect().width, callback })
    observer.observe(element)
}

export const unobserveWidth = (element: Element) => {
    callbacks.delete(element)
    observer?.unobserve(element)
}
