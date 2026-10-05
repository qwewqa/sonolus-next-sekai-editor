export type HideChange = { beat: number; hideNotes: boolean }

/**
 * Beat ranges within [start, end) during which a group shows its notes, given
 * its time scale changes sorted by beat. Mirrors the engine's
 * `schedule_connector_sfx`: the last change at or before the start sets the
 * initial state, changes strictly inside the range switch it, and a change at
 * or after the end is ignored.
 */
export const shownBeatRanges = (
    changes: readonly HideChange[],
    start: number,
    end: number,
): [number, number][] => {
    let hidden = false
    for (const change of changes) {
        if (change.beat > start) break
        hidden = change.hideNotes
    }

    const ranges: [number, number][] = []
    let from = hidden ? undefined : start
    for (const change of changes) {
        if (change.beat <= start) continue
        if (change.beat >= end) break
        if (change.hideNotes && from !== undefined) {
            if (change.beat > from) ranges.push([from, change.beat])
            from = undefined
        } else if (!change.hideNotes && from === undefined) {
            from = change.beat
        }
    }
    if (from !== undefined && end > from) ranges.push([from, end])
    return ranges
}

/**
 * Times of one clip to play, dropping any within `distance` of the previous
 * kept play, as Sonolus does for scheduled effects of the same clip.
 */
export const spacedTimes = (times: readonly number[], distance: number, previous = -Infinity) => {
    const kept: number[] = []
    let last = previous
    for (const time of [...times].sort((a, b) => a - b)) {
        if (time - last < distance) continue
        kept.push(time)
        last = time
    }
    return kept
}
