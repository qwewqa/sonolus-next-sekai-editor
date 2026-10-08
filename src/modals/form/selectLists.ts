import { isApplePlatform } from '../../editor/controls/bindings'
import { swallowPress } from '../../utils/swallowPress'

// Keeps the shared list (see selectLists.css) to a system list's rules.

const canOpen = typeof CSS !== 'undefined' && CSS.supports('selector(:open)')

const isOpen = (select: HTMLSelectElement) => canOpen && select.matches(':open')

/** The select whose open list holds an element, such as its focused option. */
const openSelectOf = (element: EventTarget | null) => {
    const select = element instanceof Element ? element.closest('select') : null
    return select && isOpen(select) ? select : undefined
}

/** Whether a select opens the shared list rather than the system one. */
const hasSharedList = (select: HTMLSelectElement) =>
    getComputedStyle(select).appearance === 'base-select'

// Closed system selects step their value with these keys on Windows and Linux.
const stepKeys = new Set([
    'ArrowDown',
    'ArrowRight',
    'ArrowUp',
    'ArrowLeft',
    'Home',
    'End',
    'PageUp',
    'PageDown',
])

// How far a page key moves, as a closed system select moves it.
const page = 3

/** The option index a key steps a closed select to, as a system select steps. */
export const stepOption = (
    count: number,
    selected: number,
    key: string,
    choosable: (index: number) => boolean,
) => {
    const indices = Array.from({ length: count }, (_, index) => index).filter(choosable)
    const after = (from: number) => indices.find((index) => index >= from)
    const before = (from: number) => [...indices].reverse().find((index) => index <= from)
    switch (key) {
        case 'ArrowDown':
        case 'ArrowRight':
            return after(selected + 1)
        case 'ArrowUp':
        case 'ArrowLeft':
            return before(selected - 1)
        case 'Home':
            return indices[0]
        case 'End':
            return indices.at(-1)
        case 'PageDown':
            return after(selected + page) ?? indices.at(-1)
        case 'PageUp':
            return before(selected - page) ?? indices[0]
    }
}

const isApple = isApplePlatform()

// Apple system selects open on these instead of stepping.
const openKeys = new Set(['ArrowDown', 'ArrowUp'])

// An open list holds every key, as a system one does; its own keys still work.
const hold = (event: KeyboardEvent) => {
    if (!openSelectOf(event.target)) return false
    event.stopImmediatePropagation()
    // Nor do chords reach the browser, such as Ctrl+S saving the page.
    if ((event.ctrlKey || event.metaKey) && /^[a-z]$/i.test(event.key)) event.preventDefault()
    return true
}

const step = (select: HTMLSelectElement, key: string) => {
    const { options, selectedIndex } = select
    const next = stepOption(options.length, selectedIndex, key, (index) => {
        const option = options.item(index)
        return (
            !!option && !option.disabled && !option.hidden && !option.closest('optgroup:disabled')
        )
    })
    if (!select.isConnected || next === undefined || next === selectedIndex) return
    select.selectedIndex = next
    select.dispatchEvent(new Event('input', { bubbles: true }))
    select.dispatchEvent(new Event('change', { bubbles: true }))
}

/** Keeps a list about to open within its dock: toward the side with room, and no wider. */
const fitList = (select: HTMLSelectElement) => {
    const root = document.documentElement
    const dock = select.closest('.workspace-dock-body')?.getBoundingClientRect()
    if (!dock) {
        root.style.removeProperty('--list-room')
        delete root.dataset.listToward
        return
    }
    const anchor = select.getBoundingClientRect()
    const end = dock.right - anchor.left
    const start = anchor.right - dock.left
    // The list's least width, 12rem in selectLists.css.
    const width = 12 * parseFloat(getComputedStyle(root).fontSize)
    const toStart = end < width && start > end
    root.style.setProperty('--list-room', `${toStart ? start : end}px`)
    if (toStart) root.dataset.listToward = 'start'
    else delete root.dataset.listToward
}

const onKeydown = (event: KeyboardEvent) => {
    if (hold(event)) return
    if (event.target instanceof HTMLSelectElement) fitList(event.target)
    // A closed shared list steps, one change each; Apple arrows open it where scripts can.
    const select = event.target
    if (
        !(select instanceof HTMLSelectElement) ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        !(isApple ? openKeys : stepKeys).has(event.key) ||
        !hasSharedList(select)
    )
        return
    event.preventDefault()
    if (isApple && 'showPicker' in select) {
        select.showPicker()
        return
    }
    // After the page's own handlers see the key, as a system select's step comes.
    const { key } = event
    setTimeout(() => {
        step(select, key)
    })
}

// A press outside an open list only closes it.
const onPointerDown = (event: PointerEvent) => {
    if (!canOpen) return
    const select = document.querySelector('select:open')
    if (select && !(event.target instanceof Node && select.contains(event.target)))
        swallowPress(event)
    else if (!select && event.target instanceof HTMLSelectElement) fitList(event.target)
}

/** Installs before the app mounts, ahead of its components' listeners but not module-level ones. */
export const installSelectLists = () => {
    addEventListener('keydown', onKeydown, true)
    addEventListener('keypress', hold, true)
    addEventListener('pointerdown', onPointerDown, true)
}
