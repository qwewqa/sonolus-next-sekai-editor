export type OffscreenNotePosition = {
    left: number
    right: number
    y: number
    highlighted: boolean
    opacity: number
}

export const groupOffscreenNotes = (
    notes: readonly OffscreenNotePosition[],
    width: number,
    top: number,
    bottom: number,
) => {
    const groups = new Map<
        string,
        {
            side: 'left' | 'right'
            slot: number
            y: number
            count: number
            highlighted: boolean
            opacity: number
        }
    >()
    if (!(width > 0) || bottom - top < 24) return []
    const slots = Math.max(1, Math.floor((bottom - top) / 28))
    const spacing = (bottom - top) / slots
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
        const slot = Math.min(slots - 1, Math.floor((note.y - top) / spacing))
        const key = `${side}:${slot}`
        const group = groups.get(key)
        if (group) {
            group.count++
            group.highlighted ||= note.highlighted
            group.opacity = Math.max(group.opacity, note.opacity)
        } else {
            groups.set(key, {
                side,
                slot,
                y: top + (slot + 0.5) * spacing,
                count: 1,
                highlighted: note.highlighted,
                opacity: note.opacity,
            })
        }
    }
    return [...groups.values()]
}
