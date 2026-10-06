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
import { editSelectedBpm } from './bpm'
import type { EditableEntity, EditableProperties } from './editable'
import { editSelectedCameraEvent } from './events/camera'
import { editSelectedStageMaskEvent } from './events/stage/mask'
import { editSelectedStagePivotEvent } from './events/stage/pivot'
import { editSelectedStageStyleEvent } from './events/stage/style'
import { editSelectedStageTransformEvent } from './events/stage/transform'
import { editSelectedNote } from './note'
import { editSelectedTimeScale } from './timeScale'

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
// Edits in place, so same-beat objects keep their order.
const edit = (transaction: Transaction, entity: TimingEntity, object: EditableProperties) => {
    switch (entity.type) {
        case 'bpm':
            return editSelectedBpm(transaction, entity, object)
        case 'timeScale':
            return editSelectedTimeScale(transaction, entity, object)
        case 'cameraEventJoint':
            return editSelectedCameraEvent(transaction, entity, object)
        case 'stageMaskEventJoint':
            return editSelectedStageMaskEvent(transaction, entity, object)
        case 'stagePivotEventJoint':
            return editSelectedStagePivotEvent(transaction, entity, object)
        case 'stageStyleEventJoint':
            return editSelectedStageStyleEvent(transaction, entity, object)
        case 'stageTransformEventJoint':
            return editSelectedStageTransformEvent(transaction, entity, object)
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

/** Same-beat timing objects of a kind together where the first appears, in stored order. */
export const inStoredOrder = <T>(source: State, items: T[], entityOf: (item: T) => Entity) => {
    const keys = items.map((item, index) => {
        const entity = entityOf(item)
        return entity.type === 'note' ? `${index}` : `${entity.type}:${entity.beat}`
    })
    const first = new Map<string, number>()
    for (const [index, key] of keys.entries()) if (!first.has(key)) first.set(key, index)
    const rank = (entity: Entity) =>
        getInStoreGrid(source.store.grid, entity.type, entity.beat)?.indexOf(entity) ?? 0
    return items
        .map((item, index) => ({ item, index, at: first.get(keys[index] ?? '') ?? index }))
        .sort(
            (a, b) =>
                a.at - b.at || rank(entityOf(a.item)) - rank(entityOf(b.item)) || a.index - b.index,
        )
        .map(({ item }) => item)
}

export const transformSelection = (
    source: State,
    selected: Entity[],
    changes: Map<EditableEntity, EditableProperties>,
): State => {
    const destinations = new Map<string, number>()
    const destinationOf = (entity: TimingEntity, object: EditableProperties) =>
        `${entity.type}:${'groupId' in entity ? entity.groupId : ''}:${'stageId' in entity ? entity.stageId : ''}:${object.beat ?? entity.beat}`
    for (const [entity, object] of changes) {
        if (entity.type === 'note') continue
        const destination = destinationOf(entity, object)
        destinations.set(destination, (destinations.get(destination) ?? 0) + 1)
    }
    const collides = (entity: EditableEntity, object: EditableProperties) =>
        entity.type !== 'note' && (destinations.get(destinationOf(entity, object)) ?? 0) > 1
    const changed = [...changes].filter(
        ([entity, object]) =>
            Object.entries(object).some(
                ([key, value]) => value !== (entity as unknown as Record<string, unknown>)[key],
            ) || collides(entity, object),
    )
    if (!changed.length) return source
    const stays = (entity: EditableEntity, object: EditableProperties) =>
        (object.beat ?? entity.beat) === entity.beat && !collides(entity, object)
    const transaction = createTransaction(source, { autoAddGroup: false })
    const initialBpm = getInStoreGrid(source.store.grid, 'bpm', 0)?.find(
        (entity) => entity.beat === 0,
    )
    const replacements = new Map<Entity, Entity[]>()
    for (const [entity, object] of changed) {
        if (entity.type !== 'note' && !stays(entity, object)) remove(transaction, entity)
    }
    // A same-beat pair lands in its stored order and stays a pair.
    const ordered = inStoredOrder(source, changed, ([entity]) => entity)
    const placed = new Map<Entity, number>()
    for (const [entity, object] of ordered) {
        if (entity.type === 'note') {
            replacements.set(entity, editSelectedNote(transaction, entity, object))
            continue
        }
        if (stays(entity, object)) {
            replacements.set(entity, edit(transaction, entity, object))
            continue
        }
        if (object.beat !== undefined) {
            for (const other of getInStoreGrid(transaction.store.grid, entity.type, object.beat) ??
                []) {
                if (
                    other.beat === object.beat &&
                    placed.get(other) !== entity.beat &&
                    (!('groupId' in entity) ||
                        ('groupId' in other && other.groupId === entity.groupId)) &&
                    (!('stageId' in entity) ||
                        ('stageId' in other && other.stageId === entity.stageId))
                ) {
                    remove(transaction, other)
                }
            }
        }
        const added = add(transaction, { ...entity, ...object })
        for (const other of added) placed.set(other, entity.beat)
        replacements.set(entity, added)
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
