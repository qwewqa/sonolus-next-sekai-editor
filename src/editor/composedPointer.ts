export type AffineSample = { input: number; output: number }

/**
 * Invert two samples of an affine pointer response. Samples must come from the
 * same immutable chart and topology, before snapping and lane constraints.
 * A flat or numerically unresolved response has no reliable inverse; callers
 * retain their baseline or last valid edit instead of amplifying roundoff.
 */
export const inverseAffine = (
    target: number,
    first: AffineSample,
    second: AffineSample,
): number | undefined => {
    if (![target, first.input, first.output].every(Number.isFinite)) return
    // Returning to the starting pointer preserves the exact authored values,
    // including when a second sample cannot move the projected anchor at all.
    if (target === first.output) return first.input
    if (![second.input, second.output].every(Number.isFinite)) return
    const inputSpan = second.input - first.input
    const outputSpan = second.output - first.output
    const tolerance =
        8 * Number.EPSILON * Math.max(1, Math.abs(first.output), Math.abs(second.output))
    if (
        !Number.isFinite(inputSpan) ||
        inputSpan === 0 ||
        !Number.isFinite(outputSpan) ||
        Math.abs(outputSpan) <= tolerance
    )
        return
    const result = first.input + ((target - first.output) / outputSpan) * inputSpan
    return Number.isFinite(result) ? result : undefined
}
