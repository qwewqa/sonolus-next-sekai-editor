import type { State } from '..'
import type { NoteObject } from '../../chart/note'
import { complementEase, type Ease, type TimeScaleEase } from '../../ease'
import { nearlyEqual } from '../../utils/math'
import type { Entity } from '../entities'
import type { NoteEntity } from '../entities/slides/note'
import { addBpm, removeBpm } from '../mutations/bpm'
import { addCameraEventJoint, removeCameraEventJoint } from '../mutations/events/camera'
import { addStageMaskEventJoint, removeStageMaskEventJoint } from '../mutations/events/stage/mask'
import {
    addStagePivotEventJoint,
    removeStagePivotEventJoint,
} from '../mutations/events/stage/pivot'
import {
    addStageStyleEventJoint,
    removeStageStyleEventJoint,
} from '../mutations/events/stage/style'
import {
    addStageTransformEventJoint,
    removeStageTransformEventJoint,
} from '../mutations/events/stage/transform'
import { addNote, removeNote } from '../mutations/slides/note'
import { addTimeScale, removeTimeScale } from '../mutations/timeScale'
import { getInStoreGrid } from '../store/grid'
import { createTransaction, type Transaction } from '../transaction'
import { connectorProperties } from './connectorProperties'
import { isEditableEntity, type EditableEntity } from './editable'
import { edit, inStoredOrder } from './transformSelection'

const reverseSlideProperties = (source: State, selected: Set<EditableEntity>) => {
    const properties = new Map<NoteEntity, Partial<NoteObject>>()
    const ids = new Set(
        [...selected].filter((entity) => entity.type === 'note').map((note) => note.slideId),
    )
    for (const id of ids) {
        const notes = source.store.slides.note.get(id)
        if (!notes || notes.length < 2 || !notes.every((note) => selected.has(note))) continue

        const segments = notes.filter(
            (note, index) => index === 0 || index === notes.length - 1 || note.isConnectorSeparator,
        )
        const attachments = notes.filter(
            (note, index) => index === 0 || index === notes.length - 1 || !note.isAttached,
        )
        // After reversal an interval's former tail owns its outgoing properties.
        // Rotate the unused last endpoint's properties too, so flipping twice
        // restores them along with the visible segments.
        for (const [index, note] of segments.entries()) {
            const previous = segments.at(index - 1)
            if (previous) properties.set(note, connectorProperties(previous))
        }
        for (const [index, note] of attachments.entries()) {
            const previous = attachments.at(index - 1)
            if (previous)
                properties.set(note, {
                    ...properties.get(note),
                    connectorEase: complementEase(previous.connectorEase),
                })
        }
    }
    return properties
}

// Segments run back: a joint takes its predecessor's ease complemented, the first the last's.
const reverseEases = (source: State, entities: EditableEntity[]) => {
    const tracks = new Map<string, EditableEntity[]>()
    for (const entity of entities) {
        if (entity.type === 'note' || entity.type === 'bpm') continue
        const key = `${entity.type}:${'groupId' in entity ? entity.groupId : ''}:${'stageId' in entity ? entity.stageId : ''}`
        const track = tracks.get(key)
        if (track) track.push(entity)
        else tracks.set(key, [entity])
    }
    const easeOf = (entity: EditableEntity) =>
        entity.type === 'timeScale'
            ? entity.timeScaleEase
            : (entity as { eventEase: Ease }).eventEase
    const eases = new Map<EditableEntity, { timeScaleEase?: TimeScaleEase; eventEase?: Ease }>()
    for (const track of tracks.values()) {
        const joints = inStoredOrder(source, track, (entity) => entity).sort(
            (a, b) => a.beat - b.beat,
        )
        for (const [index, joint] of joints.entries()) {
            const previous = joints[index - 1]
            const ease = previous
                ? complementEase(easeOf(previous))
                : easeOf(joints.at(-1) ?? joint)
            eases.set(
                joint,
                joint.type === 'timeScale'
                    ? { timeScaleEase: ease as TimeScaleEase }
                    : { eventEase: ease },
            )
        }
    }
    return eases
}

export const flipVertical = (source: State, selected: Entity[]): State => {
    const entities = [...new Set(selected.filter(isEditableEntity))]
    if (!entities.length) return source
    let min = Infinity
    let max = -Infinity
    for (const entity of entities) {
        min = Math.min(min, entity.beat)
        max = Math.max(max, entity.beat)
    }
    if (min === max) return source

    const selectedSet = new Set(entities)
    const properties = reverseSlideProperties(source, selectedSet)
    const transaction = createTransaction(source)
    const initialBpm = getInStoreGrid(source.store.grid, 'bpm', 0)?.find((bpm) => bpm.beat === 0)

    // The centre, within float noise far below any beat grid, keeps its exact beat.
    const flippedBeat = (entity: EditableEntity) =>
        nearlyEqual(min + max, 2 * entity.beat) ? entity.beat : min + (max - entity.beat)
    // On its own beat beside an unselected partner, it is edited in place and keeps its order.
    const stays = (entity: EditableEntity) =>
        entity.type !== 'note' &&
        flippedBeat(entity) === entity.beat &&
        (getInStoreGrid(source.store.grid, entity.type, entity.beat) ?? []).some(
            (other) =>
                other.beat === entity.beat && sameTrack(entity, other) && !selectedSet.has(other),
        )

    // Remove the entire selection first. Sequential moves can otherwise delete
    // each other's destination, particularly when swapping BPMs and events.
    for (const entity of entities) if (!stays(entity)) remove(transaction, entity)
    // A same-beat pair stays a pair, its order mirrored as the jump now runs back.
    const ordered = inStoredOrder(source, entities, (entity) => entity, true)
    const eases = reverseEases(source, entities)
    const placed = new Map<Entity, number>()
    const flipped: Entity[] = []
    for (const entity of ordered) {
        if (entity.type !== 'note' && stays(entity)) {
            flipped.push(...edit(transaction, entity, eases.get(entity) ?? {}))
            continue
        }
        const beat = flippedBeat(entity)
        if (entity.type !== 'note') {
            // Match the editor's move behavior: a timing point replaces an
            // occupied destination in its own group/stage, never another lane.
            for (const other of getInStoreGrid(transaction.store.grid, entity.type, beat) ?? []) {
                if (
                    other.beat === beat &&
                    placed.get(other) !== entity.beat &&
                    sameTrack(entity, other)
                )
                    remove(transaction, other)
            }
        }
        const added = add(transaction, {
            ...entity,
            ...(entity.type === 'note' ? properties.get(entity) : eases.get(entity)),
            beat,
        })
        for (const other of added) placed.set(other, entity.beat)
        flipped.push(...added)
    }
    // Moving the initial BPM must not leave the chart without a tempo at zero.
    if (
        initialBpm &&
        !getInStoreGrid(transaction.store.grid, 'bpm', 0)?.some((bpm) => bpm.beat === 0)
    )
        addBpm(transaction, initialBpm)

    return transaction.commit(flipped)
}

// The same group or stage, where the kind has one.
const sameTrack = (entity: Entity, other: Entity) =>
    (!('groupId' in entity) || ('groupId' in other && other.groupId === entity.groupId)) &&
    (!('stageId' in entity) || ('stageId' in other && other.stageId === entity.stageId))

const remove = (transaction: Transaction, entity: EditableEntity) => {
    switch (entity.type) {
        case 'bpm': {
            removeBpm(transaction, entity)
            return
        }
        case 'timeScale': {
            removeTimeScale(transaction, entity)
            return
        }
        case 'cameraEventJoint': {
            removeCameraEventJoint(transaction, entity)
            return
        }
        case 'stageMaskEventJoint': {
            removeStageMaskEventJoint(transaction, entity)
            return
        }
        case 'stagePivotEventJoint': {
            removeStagePivotEventJoint(transaction, entity)
            return
        }
        case 'stageStyleEventJoint': {
            removeStageStyleEventJoint(transaction, entity)
            return
        }
        case 'stageTransformEventJoint': {
            removeStageTransformEventJoint(transaction, entity)
            return
        }
        case 'note': {
            removeNote(transaction, entity)
            return
        }
    }
}

const add = (transaction: Transaction, entity: EditableEntity) => {
    switch (entity.type) {
        case 'bpm':
            return addBpm(transaction, entity)
        case 'timeScale':
            return addTimeScale(transaction, entity)
        case 'cameraEventJoint':
            return addCameraEventJoint(transaction, entity)
        case 'stageMaskEventJoint':
            return addStageMaskEventJoint(transaction, entity)
        case 'stagePivotEventJoint':
            return addStagePivotEventJoint(transaction, entity)
        case 'stageStyleEventJoint':
            return addStageStyleEventJoint(transaction, entity)
        case 'stageTransformEventJoint':
            return addStageTransformEventJoint(transaction, entity)
        case 'note':
            return addNote(transaction, entity.slideId, entity)
    }
}
