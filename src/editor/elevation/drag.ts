import { safeUnlerpClamped } from '../../utils/math'

export type AttachedElevationDrag = {
    head: number
    tail: number
    note: number
    headStage: number
    tailStage: number
    headMoves: boolean | number
    tailMoves: boolean | number
    noteMoves?: number
    headStageMoves?: number
    tailStageMoves?: number
}

/** The grabbed tick follows a shared raw elevation edit, including selected anchors. */
export const attachedDragElevation = (drag: AttachedElevationDrag, delta: number) => {
    const head = drag.head + +drag.headMoves * delta
    const tail = drag.tail + +drag.tailMoves * delta
    const headStage = drag.headStage + (drag.headStageMoves ?? 0) * delta
    const tailStage = drag.tailStage + (drag.tailStageMoves ?? 0) * delta
    const fraction = safeUnlerpClamped(head, tail, drag.note + (drag.noteMoves ?? 1) * delta)
    return head + headStage + (tail + tailStage - head - headStage) * fraction
}

/**
 * Invert the clamped, sometimes rational response, including opening/reversing spans.
 * Of multiple valid positions, retain the branch nearest the previous pointer edit.
 * A flat response stays put; an unreachable pointer stops at the closest endpoint.
 */
export const inverseAttachedElevation = (
    drag: AttachedElevationDrag,
    target: number,
    previous = 0,
) => {
    const initial = attachedDragElevation(drag, 0)
    if (!Number.isFinite(target) || target === initial) return 0
    const headMoves = +drag.headMoves
    const tailMoves = +drag.tailMoves
    const span = drag.tail - drag.head
    const spanDelta = tailMoves - headMoves
    const offset = drag.note - drag.head
    const offsetDelta = (drag.noteMoves ?? 1) - headMoves
    const stageSpan = drag.tailStage - drag.headStage
    const stageSpanDelta = (drag.tailStageMoves ?? 0) - (drag.headStageMoves ?? 0)
    const noteAndStageDelta = (drag.noteMoves ?? 1) + (drag.headStageMoves ?? 0)
    const candidates = [0, previous]
    const linear = (constant: number, coefficient: number) => {
        if (coefficient !== 0) candidates.push(-constant / coefficient)
    }
    const quadratic = (a: number, b: number, c: number) => {
        if (a === 0) linear(c, b)
        else {
            const discriminant = b * b - 4 * a * c
            if (discriminant >= 0 && Number.isFinite(discriminant)) {
                const q = -(b + (b < 0 ? -1 : 1) * Math.sqrt(discriminant)) / 2
                if (q === 0) candidates.push(-b / (2 * a))
                else candidates.push(q / a, c / q)
            }
        }
    }
    // Inside endpoints, multiply the target equation by the changing raw span.
    const constant = drag.note + drag.headStage - target
    quadratic(
        noteAndStageDelta * spanDelta + stageSpanDelta * offsetDelta,
        noteAndStageDelta * span +
            constant * spanDelta +
            stageSpan * offsetDelta +
            stageSpanDelta * offset,
        span * constant + stageSpan * offset,
    )
    // Engine spans below 1e-6 use the midpoint. A selected endpoint can open that span.
    linear(
        (drag.head + drag.headStage + drag.tail + drag.tailStage) / 2 - target,
        (headMoves + (drag.headStageMoves ?? 0) + tailMoves + (drag.tailStageMoves ?? 0)) / 2,
    )
    // Clamped portions and their boundaries, including authored out-of-range ticks.
    linear(drag.head + drag.headStage - target, headMoves + (drag.headStageMoves ?? 0))
    linear(drag.tail + drag.tailStage - target, tailMoves + (drag.tailStageMoves ?? 0))
    linear(offset, offsetDelta)
    linear(offset - span, offsetDelta - spanDelta)
    linear(span - 1e-6, spanDelta)
    linear(span + 1e-6, spanDelta)
    linear(span, spanDelta)
    if (spanDelta !== 0) {
        // The strict midpoint band can lose either one-sided limit to rounding.
        // Keep representable samples on both sides as well as its center.
        for (const boundary of [(1e-6 - span) / spanDelta, (-1e-6 - span) / spanDelta])
            for (const direction of [-1, 1])
                candidates.push(
                    boundary + direction * 4 * Number.EPSILON * Math.max(1, Math.abs(boundary)),
                )
    }
    // A co-selected anchor can turn the response around before either endpoint.
    quadratic(
        noteAndStageDelta * spanDelta * spanDelta + stageSpanDelta * offsetDelta * spanDelta,
        2 * noteAndStageDelta * span * spanDelta + 2 * stageSpanDelta * offsetDelta * span,
        noteAndStageDelta * span * span +
            (stageSpan * offsetDelta + stageSpanDelta * offset) * span -
            spanDelta * stageSpan * offset,
    )
    let best = 0
    let distance = Math.abs(initial - target)
    const tolerance = 32 * Number.EPSILON * Math.max(1, Math.abs(initial), Math.abs(target))
    for (const delta of candidates) {
        if (!Number.isFinite(delta)) continue
        const nextDistance = Math.abs(attachedDragElevation(drag, delta) - target)
        if (
            nextDistance < distance - tolerance ||
            (Math.abs(nextDistance - distance) <= tolerance &&
                Math.abs(delta - previous) < Math.abs(best - previous))
        ) {
            best = delta
            distance = nextDistance
        }
    }
    return best
}
