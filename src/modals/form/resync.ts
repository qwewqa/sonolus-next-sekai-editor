import { nextTick, onMounted, type Ref } from 'vue'
import { isComposingKey } from '../../utils/composition'

/** Standalone single-line edits finish on Enter; submitting forms keep their own action. */
export const confirmOnEnter = async (event: KeyboardEvent) => {
    if (
        event.defaultPrevented ||
        isComposingKey(event) ||
        event.repeat ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.shiftKey
    )
        return
    const input = event.currentTarget
    if (!(input instanceof HTMLInputElement) || input.form) return
    event.preventDefault()
    event.stopPropagation()
    // Native blur runs the field's existing change/validation and preview commit logic.
    input.blur()
    // reportValidity can focus a rejected entry again. Let resync restore the committed
    // value before releasing that focus, so invalid standalone edits also finish.
    await nextTick()
    if (document.activeElement === input) input.blur()
    // Keep a tool dialog's focus ownership so Escape closes it and restores its opener.
    if (document.activeElement === document.body)
        input.closest<HTMLElement>('[data-tool-dialog]')?.focus({ preventScroll: true })
}

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
    // A validating form keeps the entry, so its validation blocks the submit.
    if (input.form && !input.form.noValidate) return
    await nextTick()
    if (input.value !== text()) input.value = text()
}

// Unparseable text in a number input reads as empty.
export const isTyped = (input: HTMLInputElement, text: string) =>
    input.value !== text || input.validity.badInput

/** Escape reverts typed text the input hasn't committed; otherwise it passes on. */
export const revertOnEscape = (event: KeyboardEvent, text: string) => {
    const input = event.currentTarget as HTMLInputElement
    if (isComposingKey(event) || !isTyped(input, text)) return
    event.stopPropagation()
    event.preventDefault()
    input.value = text
}

const typingChecks = new WeakMap<Element, () => boolean>()

/** Registers how a field tells uncommitted typing from its committed value. */
const trackTyping = (input: Ref<HTMLInputElement | null>, isTyping: () => boolean) => {
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
