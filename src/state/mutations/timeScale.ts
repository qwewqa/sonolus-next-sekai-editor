import type { AddMutation, RemoveMutation, ReplaceMutation } from '.'
import type { TimeScaleObject } from '../../chart/timeScale'
import { toTimeScaleEntity, type TimeScaleEntity } from '../entities/timeScale'
import { addToStoreGrid, removeFromStoreGrid, replaceInStoreGrid } from '../store/grid'

export const addTimeScale: AddMutation<TimeScaleObject> = ({ store }, object) => {
    const entity = toTimeScaleEntity(object)
    addToStoreGrid(store.grid, entity, entity.beat)

    return [entity]
}

export const removeTimeScale: RemoveMutation<TimeScaleEntity> = ({ store }, entity) => {
    removeFromStoreGrid(store.grid, entity, entity.beat)
}

export const replaceTimeScale: ReplaceMutation<TimeScaleEntity, TimeScaleObject> = (
    { store },
    entity,
    object,
) => {
    const replacement = toTimeScaleEntity(object)
    replaceInStoreGrid(store.grid, entity, replacement, entity.beat)

    return [replacement]
}
