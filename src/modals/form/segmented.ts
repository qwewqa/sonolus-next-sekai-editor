/** Sizes of the segmented control, in rem. */
export const segmentedSizes = {
    /** Track padding on both sides. */
    track: 0.25,
    /** Padding inside each segment. */
    segment: 1,
    /** Width of the leading unset segment. */
    unset: 2,
}

/** Width, in px, the segments need to show every label in full. */
export const segmentedWidth = (labelWidths: readonly number[], optional: boolean, rem: number) =>
    labelWidths.reduce((total, width) => total + width + segmentedSizes.segment * rem, 0) +
    (optional ? segmentedSizes.unset * rem : 0) +
    segmentedSizes.track * rem

/** Segments fit when no label would be cut off; otherwise the field is a select. */
export const segmentsFit = (
    availableWidth: number,
    labelWidths: readonly number[],
    optional: boolean,
    rem: number,
) => availableWidth > 0 && segmentedWidth(labelWidths, optional, rem) <= availableWidth

/** Room, in rem, a glyph and its gap take before a segment's name. */
export const segmentGlyphWidth = 1.25

/** A select's insets, in rem, around its value with a leading glyph and the chevron. */
export const selectGlyphInsets = 4.125

export type ChoiceLayout = 'glyphs' | 'segments' | 'select'

/** Glyphs drop before the segments do; the select comes last. */
export const choiceLayout = (
    availableWidth: number,
    labelWidths: readonly number[],
    optional: boolean,
    rem: number,
    glyphs: boolean,
): ChoiceLayout =>
    glyphs &&
    segmentsFit(
        availableWidth,
        labelWidths.map((width) => width + segmentGlyphWidth * rem),
        optional,
        rem,
    )
        ? 'glyphs'
        : segmentsFit(availableWidth, labelWidths, optional, rem)
          ? 'segments'
          : 'select'

/** A select shows the value's glyph only when every name still fits beside it. */
export const selectGlyphFits = (
    availableWidth: number,
    labelWidths: readonly number[],
    rem: number,
) => availableWidth > 0 && Math.max(0, ...labelWidths) <= availableWidth - selectGlyphInsets * rem
