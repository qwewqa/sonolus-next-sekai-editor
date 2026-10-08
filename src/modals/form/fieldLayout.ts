import { inject, type InjectionKey } from 'vue'
import { PLAIN_PADDING } from './leadFit'

/** Fields whose value would truncate beside the label take the row below it. */
export const stackLongValuesKey: InjectionKey<boolean> = Symbol('stackLongValues')

export const useStackLongValues = () => inject(stackLongValuesKey, false)

/** Fields whose label would break inside a word take the row below it. */
export const stackLongWordsKey: InjectionKey<boolean> = Symbol('stackLongWords')

export const useStackLongWords = () => inject(stackLongWordsKey, false)

let context: CanvasRenderingContext2D | null | undefined

/**
 * Whether a control's shown value, or any of `others` it can switch to, is wider
 * than the room its pill gives it.
 */
export const valueOverflows = (control: HTMLElement, others: string[] = []) => {
    const style = getComputedStyle(control)
    const measure = (context ??= document.createElement('canvas').getContext('2d'))
    if (!measure) return false
    measure.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
    const text =
        control instanceof HTMLSelectElement
            ? (control.selectedOptions[0]?.textContent.trim() ?? '')
            : control instanceof HTMLInputElement
              ? control.value || control.placeholder
              : control.textContent.trim()
    // A leading glyph gives way before the value moves, so its room counts.
    const padding = parseFloat(style.paddingLeft)
    const left = control.closest('.form-field-select-leading')
        ? Math.min(padding, PLAIN_PADDING)
        : padding
    const room = control.clientWidth - left - parseFloat(style.paddingRight)
    return (
        Math.max(...[text, ...others].map((text) => measure.measureText(text).width)) > room + 0.5
    )
}

/** Whether a label's longest word or phrase is wider than its box, so would break inside. */
export const wordOverflows = (label: HTMLElement) => {
    const { width, overflowWrap, flexShrink } = label.style
    const room = label.getBoundingClientRect().width
    // At min-content width, unshrunk, a label is as wide as its longest unbreakable part.
    Object.assign(label.style, { width: 'min-content', overflowWrap: 'normal', flexShrink: '0' })
    const longest = label.getBoundingClientRect().width
    Object.assign(label.style, { width, overflowWrap, flexShrink })
    // A word even a fraction wider than the box breaks.
    return longest > room + 0.01
}
