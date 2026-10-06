export type OffscreenNotePosition<T = unknown> = {
    left: number
    right: number
    y: number
    highlighted: boolean
    opacity: number
    // Set when the note can be selected from its badge.
    target?: T
}

export type OffscreenNoteGroup<T = unknown> = {
    side: 'left' | 'right'
    slot: number
    y: number
    spacing: number
    count: number
    highlighted: boolean
    opacity: number
    targets: T[]
}

// One line of the chart's corner range labels.
export const RANGE_LABEL_HEIGHT = 24

/** Badges sit inset from top and bottom; notes in those margins count in the nearest slot. */
export const groupOffscreenNotes = <T>(
    notes: readonly OffscreenNotePosition<T>[],
    width: number,
    top: number,
    bottom: number,
    inset = 0,
) => {
    const groups = new Map<string, OffscreenNoteGroup<T>>()
    const first = top + inset
    if (!(width > 0) || bottom - inset - first < 24) return []
    const slots = Math.max(1, Math.floor((bottom - inset - first) / 28))
    const spacing = (bottom - inset - first) / slots
    for (const note of notes) {
        if (
            !Number.isFinite(note.left) ||
            !Number.isFinite(note.right) ||
            !Number.isFinite(note.y) ||
            note.y < top ||
            note.y > bottom
        )
            continue
        const side = note.right < 0 ? 'left' : note.left > width ? 'right' : undefined
        if (!side) continue
        const slot = Math.min(slots - 1, Math.max(0, Math.floor((note.y - first) / spacing)))
        const key = `${side}:${slot}`
        let group = groups.get(key)
        if (group) {
            group.count++
            group.highlighted ||= note.highlighted
            group.opacity = Math.max(group.opacity, note.opacity)
        } else {
            group = {
                side,
                slot,
                y: first + (slot + 0.5) * spacing,
                spacing,
                count: 1,
                highlighted: note.highlighted,
                opacity: note.opacity,
                targets: [],
            }
            groups.set(key, group)
        }
        if (note.target !== undefined) group.targets.push(note.target)
    }
    return [...groups.values()]
}

// Badge width estimate (inset, chevron, digits) with slack; at least a touch target.
export const offscreenBadgeHitWidth = (count: number) => Math.max(44, 40 + 7 * String(count).length)

// Selectable badge whose hit area (slot band, out from the edge) holds a pane point.
export const hitOffscreenGroup = <T>(
    groups: readonly OffscreenNoteGroup<T>[],
    x: number,
    y: number,
    width: number,
) =>
    groups.find((group) => {
        if (!group.targets.length || Math.abs(y - group.y) > group.spacing / 2) return false
        const reach = offscreenBadgeHitWidth(group.count)
        return group.side === 'left' ? x >= 0 && x <= reach : x <= width && x >= width - reach
    })

// Ctrl removes the targets when all are selected and adds them otherwise.
export const combineSelection = <T>(
    selected: readonly T[],
    targets: readonly T[],
    ctrl: boolean,
) => {
    if (!ctrl) return [...targets]
    const current = new Set(selected)
    if (targets.every((target) => current.has(target))) {
        const removed = new Set(targets)
        return selected.filter((entity) => !removed.has(entity))
    }
    return [...new Set([...selected, ...targets])]
}
