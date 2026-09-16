type Entry<T> = {
    item: T
    index: number
    start: number
    end: number
}

export type TimeIndex<T> = {
    entries: Entry<T>[]
    maxEnds: Float64Array
    offset: number
}

// Intervals may overlap (long holds), and input order is also the draw/particle
// seed order. Sort a separate index and restore input order after each query.
export const createTimeIndex = <T>(
    items: T[],
    start: (item: T) => number,
    end: (item: T) => number,
): TimeIndex<T> => {
    const entries = items
        .map((item, index) => ({ item, index, start: start(item), end: end(item) }))
        .sort((a, b) => a.start - b.start)
    let offset = 1
    while (offset < entries.length) offset *= 2
    const maxEnds = new Float64Array(offset * 2).fill(-Infinity)
    entries.forEach((entry, index) => {
        maxEnds[offset + index] = entry.end
    })
    for (let index = offset - 1; index > 0; index--) {
        maxEnds[index] = Math.max(
            maxEnds[index * 2] ?? -Infinity,
            maxEnds[index * 2 + 1] ?? -Infinity,
        )
    }
    return { entries, maxEnds, offset }
}

// Select intervals with start <= latestStart and end > now. A maximum-end tree
// prevents one long hold from forcing a scan over all the notes preceding it.
export const queryTimeIndex = <T>(index: TimeIndex<T>, now: number, latestStart: number) => {
    const matches: Entry<T>[] = []
    const visit = (node: number, left: number, right: number) => {
        const entry = index.entries[left]
        if (!entry || entry.start > latestStart || (index.maxEnds[node] ?? -Infinity) <= now) return
        if (right - left === 1) {
            matches.push(entry)
            return
        }
        const middle = (left + right) >>> 1
        visit(node * 2, left, middle)
        visit(node * 2 + 1, middle, right)
    }
    visit(1, 0, index.offset)
    return matches.sort((a, b) => a.index - b.index)
}
