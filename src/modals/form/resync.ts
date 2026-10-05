import { nextTick } from 'vue'

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
