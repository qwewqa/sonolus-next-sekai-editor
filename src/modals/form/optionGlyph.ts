import { h, type FunctionalComponent, type VNode } from 'vue'

/** A value's list picture: null when it has none, as no flick; undefined when unknown. */
export type OptionGlyph<T> = (value: T) => VNode | null | undefined

/** Whether every value's picture is known, so the list shows the column. */
export const hasGlyphColumn = <T>(glyph: OptionGlyph<T> | undefined, values: readonly T[]) =>
    !!glyph && values.every((value) => glyph(value) !== undefined)

/** A list row's picture slot, blank for a value without one. */
export const OptionGlyphSlot: FunctionalComponent<{ glyph: VNode | null | undefined }> = ({
    glyph,
}) => h('span', { class: 'select-option-glyph', 'aria-hidden': 'true' }, glyph ? [glyph] : [])
OptionGlyphSlot.props = ['glyph']
