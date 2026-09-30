import type { State } from '..'
import type { Entity } from '../entities'
import { createSlideId } from '../entities/slides'
import { addNote, removeNote } from '../mutations/slides/note'
import { createTransaction } from '../transaction'
import { connectorProperties } from './connectorProperties'

export const combineNotes = (source: State, selected: Entity[]): State => {
    const slideIds = new Set(
        selected.filter((entity) => entity.type === 'note').map((note) => note.slideId),
    )
    if (slideIds.size < 2) return source

    // Stable sorting preserves chart slide order, then order within each slide,
    // when multiple notes share a beat. Selection order has no effect.
    const notes = [...source.store.slides.info]
        .filter(([id]) => slideIds.has(id))
        .flatMap(([, infos]) =>
            infos.map((info, index) => ({
                note: info.note,
                properties: connectorProperties(infos[index + 1]?.segmentHead ?? info.segmentHead),
            })),
        )
        .sort((a, b) => a.note.beat - b.note.beat)

    const transaction = createTransaction(source, { autoAddGroup: false })
    for (const { note } of notes) removeNote(transaction, note)

    const slideId = createSlideId()
    const combined = notes.flatMap(({ note, properties }, index) => {
        const previous = notes[index - 1]?.properties
        const changed = previous && JSON.stringify(previous) !== JSON.stringify(properties)
        return addNote(transaction, slideId, {
            ...note,
            ...properties,
            // Interleaving another slide changes attachment anchors. Preserve
            // every note's current position instead of interpolating it again.
            isAttached: false,
            isConnectorSeparator: note.isConnectorSeparator || !!changed,
        })
    })
    return transaction.commit([...selected.filter((entity) => entity.type !== 'note'), ...combined])
}
