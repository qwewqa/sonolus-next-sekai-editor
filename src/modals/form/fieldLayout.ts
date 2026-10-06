import { inject, type InjectionKey } from 'vue'

/** Fields whose value would truncate beside the label take the row below it. */
export const stackLongValuesKey: InjectionKey<boolean> = Symbol('stackLongValues')

export const useStackLongValues = () => inject(stackLongValuesKey, false)

let context: CanvasRenderingContext2D | null | undefined

/** Whether a select's or button's shown value is wider than the room its pill gives it. */
export const valueOverflows = (control: HTMLSelectElement | HTMLButtonElement) => {
    const style = getComputedStyle(control)
    context ??= document.createElement('canvas').getContext('2d')
    if (!context) return false
    context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
    const text =
        control instanceof HTMLSelectElement
            ? (control.selectedOptions[0]?.textContent.trim() ?? '')
            : control.textContent.trim()
    const room =
        control.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
    return context.measureText(text).width > room + 0.5
}
