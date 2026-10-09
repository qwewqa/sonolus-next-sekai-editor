import { lerp, safeUnlerpClamped } from './math'

type GuideAlphaProperties<T> = {
    beat: number | undefined
    elevation: number
    attachHead?: T
    attachTail?: T
}

/** Stable authored opacity domain; undefined leaves the existing time domain intact. */
export const elevationGuideAlphaFraction = <T>(
    marker: T,
    segmentHead: T,
    segmentTail: T,
    properties: (note: T) => GuideAlphaProperties<T>,
): number | undefined => {
    const first = properties(segmentHead)
    const last = properties(segmentTail)
    if (first.beat === undefined || first.beat !== last.beat) return
    if (marker === segmentHead) return 0
    if (marker === segmentTail) return 1

    const current = properties(marker)
    const points = [marker, segmentHead, segmentTail]
    const values = [current, first, last]
    for (const value of values) {
        const { attachHead: head, attachTail: tail } = value
        if (head === undefined || tail === undefined) continue
        const a = properties(head)
        const b = properties(tail)
        if (a.beat === undefined || a.beat !== b.beat) continue
        if (
            !points.every(
                (point, index) =>
                    point === head ||
                    point === tail ||
                    (values[index]?.attachHead === head && values[index].attachTail === tail),
            )
        )
            continue
        const fraction = (point: T, own: GuideAlphaProperties<T>) =>
            point === head
                ? 0
                : point === tail
                  ? 1
                  : safeUnlerpClamped(a.elevation, b.elevation, own.elevation)
        return safeUnlerpClamped(
            fraction(segmentHead, first),
            fraction(segmentTail, last),
            fraction(marker, current),
        )
    }

    // Different families compare their authored heights after each attachment's
    // own clamp. Animated stage transforms and lane easing never affect opacity.
    const height = (own: GuideAlphaProperties<T>) => {
        if (own.attachHead === undefined || own.attachTail === undefined) return own.elevation
        const head = properties(own.attachHead)
        const tail = properties(own.attachTail)
        return head.beat !== undefined && head.beat === tail.beat
            ? lerp(
                  head.elevation,
                  tail.elevation,
                  safeUnlerpClamped(head.elevation, tail.elevation, own.elevation),
              )
            : own.elevation
    }
    return safeUnlerpClamped(height(first), height(last), height(current))
}
