import { nextTick, onMounted, type Ref } from 'vue'

// Vue keeps an option's bound value on the element.
const optionValue = (option: HTMLOptionElement): unknown =>
    '_value' in option ? option._value : option.value

/**
 * After a change, shows the value the model actually holds: a refused or
 * cancelled pick never re-renders, so the control would keep showing it.
 */
export const resyncSelect = async (event: Event, value: () => unknown) => {
    const select = event.currentTarget as HTMLSelectElement
    await nextTick()
    const index = [...select.options].findIndex((option) => optionValue(option) === value())
    if (index >= 0 && index !== select.selectedIndex) select.selectedIndex = index
}

/** Checks the radio holding the model's value again after a refused pick. */
export const resyncRadios = async (event: Event, value: () => unknown) => {
    const group = (event.currentTarget as HTMLElement).closest('[role="radiogroup"]')
    await nextTick()
    for (const radio of group?.querySelectorAll<HTMLInputElement>('input[type="radio"]') ?? []) {
        const checked = optionValue(radio as never) === value()
        if (radio.checked !== checked) radio.checked = checked
    }
}

/** Reverts an input to its value after a rejected entry, such as blank or out of range. */
export const resyncInput = async (event: Event, text: () => string) => {
    const input = event.currentTarget as HTMLInputElement
    await nextTick()
    if (input.value !== text()) input.value = text()
}

// Unparseable text in a number input reads as empty.
const isTyped = (input: HTMLInputElement, text: string) =>
    input.value !== text || input.validity.badInput

/** Escape reverts typed text the input hasn't committed; otherwise it passes on. */
export const revertOnEscape = (event: KeyboardEvent, text: string) => {
    const input = event.currentTarget as HTMLInputElement
    if (event.isComposing || !isTyped(input, text)) return
    event.stopPropagation()
    event.preventDefault()
    input.value = text
}

const typingChecks = new WeakMap<Element, () => boolean>()

/** Registers how a field tells uncommitted typing from its committed value. */
export const trackTyping = (input: Ref<HTMLInputElement | null>, isTyping: () => boolean) => {
    onMounted(() => {
        if (input.value) typingChecks.set(input.value, isTyping)
    })
}

/** As `trackTyping`, for a field whose committed value shows as this text. */
export const trackTypedText = (input: Ref<HTMLInputElement | null>, text: () => string) => {
    trackTyping(input, () => !!input.value && isTyped(input.value, text()))
}

/** Whether a field holds typing, so undo and redo stay its own; unknown fields always do. */
export const holdsTyping = (element: Element | null) =>
    !element || (typingChecks.get(element)?.() ?? true)
