import { clipboardEntry } from '../../clipboard'
import { pushState, state } from '../../history'
import { i18n } from '../../i18n'
import { createSlideId } from '../../state/entities/slides'
import type { NoteEntity } from '../../state/entities/slides/note'
import { toNoteEntity } from '../../state/entities/slides/note'
import { addNote } from '../../state/mutations/slides/note'
import { createTransaction } from '../../state/transaction'
import { interpolate } from '../../utils/interpolate'
import { alignComputed } from '../../utils/math'
import type { Modifiers } from '../controls/gestures/pointer'
import { constrainLaneObject, minimumNoteSize } from '../laneLimits'
import { notify } from '../notification'
import { revealAuthoringTarget } from '../scope'
import { getNotePropertiesFromSelection } from '../tools/note'
import {
    getPasteNoteEntities,
    pasteAtPosition,
    toMovedNoteObject,
    toPasteBeatOffset,
} from '../tools/paste'
import { getSelectedSlideId, getSlidePropertiesFromSelection } from '../tools/slide'
import { view } from '../view'
import { getElevationStageProps } from './scene'

const getElevationProperties = (beat: number, asSlide: boolean) =>
    asSlide ? getSlidePropertiesFromSelection(beat) : getNotePropertiesFromSelection()

/** The narrowest note a drag adds, by the Zero-Width Notes setting. */
export const elevationNoteMinimum = (beat: number, asSlide: boolean) =>
    minimumNoteSize(getElevationProperties(beat, asSlide).noteType)

export const previewElevationNote = (
    lane: number,
    elevation: number,
    beat: number,
    asSlide: boolean,
    size?: number,
) => {
    const properties = getElevationProperties(beat, asSlide)
    const stage = getElevationStageProps(properties.stageId, beat)
    return toNoteEntity(
        asSlide ? (getSelectedSlideId() ?? createSlideId()) : createSlideId(),
        constrainLaneObject(
            {
                ...properties,
                beat,
                left: alignComputed(lane - stage.pivotLane),
                elevation: elevation - stage.elevation,
                size: size ?? properties.size,
            },
            { resizing: size !== undefined },
        ),
    )
}

export const createElevationNote = (
    lane: number,
    elevation: number,
    beat: number,
    asSlide: boolean,
    size?: number,
) => {
    const note = previewElevationNote(lane, elevation, beat, asSlide, size)
    // Authoring reveals its target so the new note never vanishes.
    revealAuthoringTarget(note)
    const transaction = createTransaction(state.value)
    const entities = addNote(transaction, note.slideId, note)
    const message = interpolate(
        () => (asSlide ? i18n.value.tools.slide.added : i18n.value.tools.note.added),
        `${entities.length}`,
    )
    pushState(message, transaction.commit(entities))
    view.entities = { hovered: [], creating: [] }
    notify(message)
}

const getElevationPaste = (lane: number, elevation: number, beat: number, modifiers: Modifiers) => {
    const data = clipboardEntry.value?.data
    const notes = getPasteNoteEntities()
    const first = notes.reduce<(typeof notes)[number] | undefined>(
        (first, note) => (!first || note.beat < first.beat ? note : first),
        undefined,
    )
    if (!data || !first) return
    const firstStage = getElevationStageProps(first.stageId, first.beat)
    const total = first.elevation + firstStage.elevation
    const baseElevation = Number.isFinite(total) ? total : 0
    const direction = modifiers.shift ? -1 : 1
    const mapNote = (note: NoteEntity, destinationBeat: number) => {
        const source = getElevationStageProps(note.stageId, note.beat)
        const destination = getElevationStageProps(view.stageId ?? note.stageId, destinationBeat)
        const moved = toMovedNoteObject(
            note,
            data.lane,
            lane,
            destinationBeat,
            modifiers.shift,
            false,
        )
        return constrainLaneObject({
            ...moved,
            left: alignComputed(
                moved.left +
                    direction * (source.pivotLane - firstStage.pivotLane) -
                    destination.pivotLane,
            ),
            elevation:
                note.elevation +
                source.elevation +
                elevation -
                baseElevation -
                destination.elevation,
        })
    }
    const beatOffset = toPasteBeatOffset(notes, beat - data.beat)
    return { notes, mapNote, beatOffset, startLane: data.lane }
}

export const previewElevationPaste = (
    lane: number,
    elevation: number,
    beat: number,
    modifiers: Modifiers,
) => {
    const paste = getElevationPaste(lane, elevation, beat, modifiers)
    if (!paste) return []
    return paste.notes.map((note) => {
        const destinationBeat = note.beat + paste.beatOffset
        return toNoteEntity(note.slideId, paste.mapNote(note, destinationBeat))
    })
}

export const pasteElevationNotes = async (
    lane: number,
    elevation: number,
    beat: number,
    modifiers: Modifiers,
) => {
    const paste = getElevationPaste(lane, elevation, beat, modifiers)
    if (!paste) return
    await pasteAtPosition(lane, paste.beatOffset, modifiers, {
        notesOnly: true,
        mapNote: paste.mapNote,
    })
}
