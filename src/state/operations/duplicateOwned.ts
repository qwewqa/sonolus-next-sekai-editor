import type { State } from '..'
import type { GroupId } from '../../chart/groups'
import type { StageId } from '../../chart/stages'
import type { EntityOfType } from '../entities'
import { createSlideId } from '../entities/slides'
import { addStageMaskEventJoint } from '../mutations/events/stage/mask'
import { addStagePivotEventJoint } from '../mutations/events/stage/pivot'
import { addStageStyleEventJoint } from '../mutations/events/stage/style'
import { addStageTransformEventJoint } from '../mutations/events/stage/transform'
import { addNote } from '../mutations/slides/note'
import { addTimeScale } from '../mutations/timeScale'
import type { StoreGrid } from '../store/grid'
import { createTransaction, type Transaction } from '../transaction'

/** Each owner's copy, by group or stage id. */
export type OwnerCopies =
    | { key: 'groupId'; copies: ReadonlyMap<GroupId, GroupId> }
    | { key: 'stageId'; copies: ReadonlyMap<StageId, StageId> }

const stageJoints = {
    stageMaskEventJoint: ['stageMaskEventConnection', addStageMaskEventJoint],
    stagePivotEventJoint: ['stagePivotEventConnection', addStagePivotEventJoint],
    stageStyleEventJoint: ['stageStyleEventConnection', addStageStyleEventJoint],
    stageTransformEventJoint: ['stageTransformEventConnection', addStageTransformEventJoint],
} as const

/** Every entity of a type, once each, in grid order. */
const gridEntities = <T extends keyof StoreGrid>(grid: StoreGrid, type: T) => {
    const entities = new Set<EntityOfType<T>>()
    for (const cell of grid[type].values()) for (const entity of cell) entities.add(entity)
    return entities
}

/** A stage's joints in chain order, the order export writes. */
const chainOf = <T extends keyof typeof stageJoints>(state: State, type: T, stageId: StageId) => {
    const range = state.store.stageEventRanges[type].get(stageId)
    if (!range) return []
    const next = new Map<unknown, unknown>()
    for (const connection of gridEntities(state.store.grid, stageJoints[type][0]))
        if (connection.min.stageId === stageId) next.set(connection.min, connection.max)
    const joints: EntityOfType<T>[] = []
    for (let joint: unknown = range.min; joint; joint = next.get(joint))
        joints.push(joint as EntityOfType<T>)
    return joints
}

/**
 * The state with copies of the owners' time scales or stage events and notes,
 * in source order so same-beat pairs keep theirs. Nothing existing changes.
 */
export const duplicateOwned = (state: State, owners: OwnerCopies): State => {
    const transaction: Transaction = createTransaction(state)

    if (owners.key === 'groupId') {
        for (const timeScale of gridEntities(state.store.grid, 'timeScale')) {
            const groupId = owners.copies.get(timeScale.groupId)
            if (groupId !== undefined) addTimeScale(transaction, { ...timeScale, groupId })
        }
    } else {
        for (const [stageId, copy] of owners.copies) {
            for (const type of Object.keys(stageJoints) as (keyof typeof stageJoints)[]) {
                const add = stageJoints[type][1] as (
                    transaction: Transaction,
                    object: EntityOfType<typeof type> & { stageId: StageId },
                ) => unknown
                for (const joint of chainOf(state, type, stageId))
                    add(transaction, { ...joint, stageId: copy })
            }
        }
    }

    // A slide keeps only the notes the copied owners own.
    const copyOf = (id: number) => (owners.copies as ReadonlyMap<number, number>).get(id)
    for (const notes of state.store.slides.note.values()) {
        const owned = notes.filter((note) => copyOf(note[owners.key]) !== undefined)
        if (!owned.length) continue
        const slideId = createSlideId()
        for (const note of owned)
            addNote(transaction, slideId, { ...note, [owners.key]: copyOf(note[owners.key]) })
    }

    return transaction.commit([...state.selectedEntities])
}
