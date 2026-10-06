import { clamp, lerp } from './math'

export type VisualMask = {
    enabled: boolean
    left: number
    right: number
    stageIndex?: number
}

export const noVisualMask: VisualMask = { enabled: false, left: 0, right: 0 }

/** Limits whose right edge passed the left collapse to their midpoint, as the engine does. */
export const uncrossedMask = (left: number, right: number) => {
    if (right >= left) return { left, right }
    const mid = (left + right) / 2
    return { left: mid, right: mid }
}

export const interpolateVisualMasks = (
    head: VisualMask,
    tail: VisualMask,
    frac: number,
): VisualMask =>
    head.enabled && tail.enabled
        ? {
              enabled: true,
              ...uncrossedMask(
                  lerp(head.left, tail.left, frac),
                  lerp(head.right, tail.right, frac),
              ),
              stageIndex: head.stageIndex === tail.stageIndex ? head.stageIndex : undefined,
          }
        : noVisualMask

export const maskedNoteExtents = (lane: number, rawSize: number, mask: VisualMask) => {
    const size = Math.max(0, rawSize)
    if (!mask.enabled) return { lane, size }

    const limits = uncrossedMask(mask.left, mask.right)
    const left = clamp(lane - size, limits.left, limits.right)
    const right = clamp(lane + size, limits.left, limits.right)
    return { lane: (left + right) / 2, size: (right - left) / 2 }
}
