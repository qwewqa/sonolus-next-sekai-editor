import { clamp, lerp } from './math'

export type VisualMask = {
    enabled: boolean
    left: number
    right: number
    stageIndex?: number
}

export const noVisualMask: VisualMask = { enabled: false, left: 0, right: 0 }

export const interpolateVisualMasks = (
    head: VisualMask,
    tail: VisualMask,
    frac: number,
): VisualMask =>
    head.enabled && tail.enabled
        ? {
              enabled: true,
              left: lerp(head.left, tail.left, frac),
              right: lerp(head.right, tail.right, frac),
              stageIndex: head.stageIndex === tail.stageIndex ? head.stageIndex : undefined,
          }
        : noVisualMask

export const maskedNoteExtents = (lane: number, size: number, mask: VisualMask) => {
    if (!mask.enabled) return { lane, size }

    const left = clamp(lane - size, mask.left, mask.right)
    const right = clamp(lane + size, mask.left, mask.right)
    return { lane: (left + right) / 2, size: (right - left) / 2 }
}
