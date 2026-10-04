import type { State } from '..'
import type { Entity } from '../entities'
import { createSlideId } from '../entities/slides'
import type { NoteEntity } from '../entities/slides/note'
import { addNote, removeNote } from '../mutations/slides/note'
import { createTransaction } from '../transaction'
import { connectorProperties } from './connectorProperties'
import { getMaterializedNotePositions } from './notePositions'

export const getSplitHoldNotes = (source: State, selected: Entity[]) => {
    const selectedNotes = new Set(
        selected.filter((entity): entity is NoteEntity => entity.type === 'note'),
    )
    const slideIds = new Set([...selectedNotes].map((note) => note.slideId))
    return [...slideIds].flatMap((id) => {
        const notes = source.store.slides.note.get(id) ?? []
        return notes.filter((note, index) => index < notes.length - 1 && selectedNotes.has(note))
    })
}

export const splitHold = (source: State, selected: Entity[]): State => {
    const cuts = new Set(getSplitHoldNotes(source, selected))
    if (!cuts.size) return source

    const slideIds = new Set([...cuts].map((note) => note.slideId))
    const notes = [...slideIds].flatMap((id) => source.store.slides.note.get(id) ?? [])
    const positions = getMaterializedNotePositions(source, notes)
    const transaction = createTransaction(source, { autoAddGroup: false })
    const replacements = new Map<NoteEntity, NoteEntity>()

    for (const id of slideIds) {
        const infos = source.store.slides.info.get(id)
        if (!infos) continue
        const pieces = new Map<NoteEntity, number>()
        let piece = 0
        for (const { note } of infos) {
            pieces.set(note, piece)
            if (cuts.has(note)) piece++
            removeNote(transaction, note)
        }

        let slideId = id
        for (const [index, info] of infos.entries()) {
            const { note } = info
            const previous = infos[index - 1]?.note
            const isHead = index === 0 || (!!previous && cuts.has(previous))
            if (isHead && index > 0) slideId = createSlideId()
            const detach =
                note.isAttached &&
                (pieces.get(info.attachHead) !== pieces.get(note) ||
                    pieces.get(info.attachTail) !== pieces.get(note))
            const [replacement] = addNote(transaction, slideId, {
                ...note,
                ...(isHead
                    ? connectorProperties(infos[index + 1]?.segmentHead ?? info.segmentHead)
                    : {}),
                ...(detach ? positions.get(note) : {}),
                isAttached: detach ? false : note.isAttached,
            })
            if (replacement) replacements.set(note, replacement)
        }
    }

    return transaction.commit(
        selected.flatMap<Entity>((entity) => {
            if (entity.type === 'note') return [replacements.get(entity) ?? entity]
            if (entity.type === 'connector' && slideIds.has(entity.head.slideId)) return []
            return [entity]
        }),
    )
}
