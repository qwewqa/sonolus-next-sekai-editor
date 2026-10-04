import type { State } from '..'
import type { Entity } from '../entities'
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
import { addTimeScale, removeTimeScale } from '../mutations/timeScale'
import { getInStoreGrid } from '../store/grid'
import { createTransaction, type Transaction } from '../transaction'
import type { EditableEntity, EditableObject } from './editable'
import { editSelectedNote } from './note'

type TimingEntity = Exclude<EditableEntity, { type: 'note' }>

const remove = (transaction: Transaction, entity: TimingEntity) => {
    switch (entity.type) {
        case 'bpm':
            removeBpm(transaction, entity)
            return
        case 'timeScale':
            removeTimeScale(transaction, entity)
            return
        case 'cameraEventJoint':
            removeCameraEventJoint(transaction, entity)
            return
        case 'stageMaskEventJoint':
            removeStageMaskEventJoint(transaction, entity)
            return
        case 'stagePivotEventJoint':
            removeStagePivotEventJoint(transaction, entity)
            return
        case 'stageStyleEventJoint':
            removeStageStyleEventJoint(transaction, entity)
            return
        case 'stageTransformEventJoint':
            removeStageTransformEventJoint(transaction, entity)
            return
    }
}
const add = (transaction: Transaction, entity: TimingEntity) => {
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
    }
}

export const transformSelection = (
    source: State,
    selected: Entity[],
    changes: Map<EditableEntity, EditableObject>,
): State => {
    const destinations = new Map<string, number>()
    const destinationOf = (entity: TimingEntity, object: EditableObject) =>
        `${entity.type}:${'groupId' in entity ? entity.groupId : ''}:${'stageId' in entity ? entity.stageId : ''}:${object.beat ?? entity.beat}`
    for (const [entity, object] of changes) {
        if (entity.type === 'note') continue
        const destination = destinationOf(entity, object)
        destinations.set(destination, (destinations.get(destination) ?? 0) + 1)
    }
    const changed = [...changes].filter(
        ([entity, object]) =>
            Object.entries(object).some(
                ([key, value]) => value !== (entity as unknown as Record<string, unknown>)[key],
            ) ||
            (entity.type !== 'note' && (destinations.get(destinationOf(entity, object)) ?? 0) > 1),
    )
    if (!changed.length) return source
    const transaction = createTransaction(source, { autoAddGroup: false })
    const initialBpm = getInStoreGrid(source.store.grid, 'bpm', 0)?.find(
        (entity) => entity.beat === 0,
    )
    const replacements = new Map<Entity, Entity[]>()
    for (const [entity] of changed) {
        if (entity.type !== 'note') remove(transaction, entity)
    }
    for (const [entity, object] of changed) {
        if (entity.type === 'note') {
            replacements.set(entity, editSelectedNote(transaction, entity, object))
            continue
        }
        if (object.beat !== undefined) {
            for (const other of getInStoreGrid(transaction.store.grid, entity.type, object.beat) ??
                []) {
                if (
                    other.beat === object.beat &&
                    (!('groupId' in entity) ||
                        ('groupId' in other && other.groupId === entity.groupId)) &&
                    (!('stageId' in entity) ||
                        ('stageId' in other && other.stageId === entity.stageId))
                ) {
                    remove(transaction, other)
                }
            }
        }
        replacements.set(entity, add(transaction, { ...entity, ...object }))
    }
    if (
        initialBpm &&
        !getInStoreGrid(transaction.store.grid, 'bpm', 0)?.some((entity) => entity.beat === 0)
    ) {
        addBpm(transaction, initialBpm)
    }
    const result = transaction.commit(
        [...new Set(selected)].flatMap((entity) => replacements.get(entity) ?? [entity]),
    )
    result.selectedEntities = result.selectedEntities.filter((entity) =>
        getInStoreGrid(result.store.grid, entity.type, entity.beat)?.includes(entity),
    )
    return result
}
