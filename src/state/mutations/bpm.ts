import type { AddMutation, RemoveMutation, ReplaceMutation } from '.'
import type { BpmObject } from '../../chart/bpm'
import { bisect } from '../../utils/ordered'
import { toBpmEntity, type BpmEntity } from '../entities/bpm'
import { toBpmIntegral, type BpmIntegral } from '../integrals/bpms'
import type { Store } from '../store'
import {
    addToStoreGrid,
    getInStoreGrid,
    removeFromStoreGrid,
    replaceInStoreGrid,
} from '../store/grid'

// Same-beat changes keep one order in the grid and the integrals, so each
// change's integral is found by its rank among the changes at its beat.
const integralIndex = (store: Store, bpms: BpmIntegral[], entity: BpmEntity) => {
    const rank =
        getInStoreGrid(store.grid, 'bpm', entity.beat)
            ?.filter((other) => other.beat === entity.beat)
            .indexOf(entity) ?? -1
    return rank < 0 ? -1 : bisect(bpms, 'x', entity.beat) + rank
}

export const addBpm: AddMutation<BpmObject> = ({ store, bpms }, object) => {
    // After any change already at this beat, as the grid adds it.
    let index = bisect(bpms, 'x', object.beat)
    while (bpms[index]?.x === object.beat) index++
    bpms.splice(index, 0, toBpmIntegral(object))

    const entity = toBpmEntity(object)
    addToStoreGrid(store.grid, entity, entity.beat)

    return [entity]
}

export const removeBpm: RemoveMutation<BpmEntity> = ({ store, bpms }, entity) => {
    const index = integralIndex(store, bpms, entity)
    if (bpms[index]?.x === entity.beat) bpms.splice(index, 1)

    removeFromStoreGrid(store.grid, entity, entity.beat)
}

export const replaceBpm: ReplaceMutation<BpmEntity, BpmObject> = (
    { store, bpms },
    entity,
    object,
) => {
    const index = integralIndex(store, bpms, entity)
    if (bpms[index]?.x === entity.beat) bpms[index] = toBpmIntegral(object)

    const replacement = toBpmEntity(object)
    replaceInStoreGrid(store.grid, entity, replacement, entity.beat)

    return [replacement]
}
