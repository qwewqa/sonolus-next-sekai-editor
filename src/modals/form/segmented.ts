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
