import { createSlideInfoLookup } from '../../entities/slides/lookup'
import type { NoteEntity } from '../../entities/slides/note'
import type { Store } from '../../store'

export type NoteFields = {
    elevation: boolean
    noteStyle: boolean
    connectorStyle: boolean
    isAttached: boolean
    left: boolean
    size: boolean
    isCritical: boolean
    flickDirection: boolean
    isFake: boolean
    sfx: boolean
    isConnectorSeparator: boolean
    connectorType: boolean
    connectorEase: boolean
    connectorIsFake: boolean
    connectorActiveIsCritical: boolean
    connectorGuideAlpha: boolean
    connectorLayer: boolean
    connectorIsPassThrough: boolean
    connectorPresentation: boolean
}

type SlideInfo = NonNullable<ReturnType<Store['slides']['info']['get']>>[number]

/** Which note fields a note uses, from its place in its slide. */
export const noteFieldsOf = (infos: readonly SlideInfo[], info: SlideInfo): NoteFields => {
    const note = info.note
    const isFirst = infos[0] === info
    const isLast = infos[infos.length - 1] === info
    const isInActive = info.activeHead !== info.activeTail
    const isActiveHead = info.activeHead === info.note
    const isActiveTail = info.activeTail === info.note
    const isInGuide = info.guideHead !== info.guideTail
    const isGuideHead = info.guideHead === info.note
    const isGuideTail = info.guideTail === info.note
    // Segment flags are read from the note starting the segment.
    const isSegmentHead = (isFirst || note.isConnectorSeparator) && !isLast

    return {
        elevation: isFirst || isLast || !note.isAttached,
        noteStyle: note.noteType !== 'anchor',
        connectorStyle: isSegmentHead,
        isAttached: !isFirst && !isLast,
        left: isFirst || isLast || !note.isAttached,
        size: isFirst || isLast || !note.isAttached,
        isCritical: note.noteType !== 'anchor' && note.noteType !== 'damage',
        flickDirection:
            note.noteType === 'trace' ||
            (note.noteType === 'default' && (!isInActive || isActiveHead || isActiveTail)) ||
            note.noteType === 'forceNonTick',
        isFake: note.noteType !== 'anchor',
        // Anchors are never scored, so they play no sound.
        sfx: !note.isFake && note.noteType !== 'anchor',
        isConnectorSeparator: !isFirst && !isLast,
        connectorType: isSegmentHead,
        connectorEase: (isFirst || !note.isAttached) && !isLast,
        connectorIsFake:
            isSegmentHead && (note.connectorType === 'active' || note.connectorType === 'damage'),
        connectorActiveIsCritical: isSegmentHead && note.connectorType === 'active',
        connectorGuideAlpha: isInGuide && (isGuideHead || note.isConnectorSeparator || isGuideTail),
        connectorLayer: isSegmentHead,
        connectorIsPassThrough: isSegmentHead,
        connectorPresentation: isSegmentHead,
    }
}

const lookup = createSlideInfoLookup()

export const getNoteFieldsIn = (store: Store, note: NoteEntity): NoteFields => {
    const infos = store.slides.info.get(note.slideId)
    if (!infos) throw new Error('Unexpected missing infos')

    const info = lookup(infos).get(note) as SlideInfo | undefined
    if (!info) throw new Error('Unexpected missing info')

    return noteFieldsOf(infos, info)
}
