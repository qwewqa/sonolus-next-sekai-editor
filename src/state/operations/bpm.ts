import type { BpmObject } from '../../chart/bpm'
import type { BpmEntity } from '../entities/bpm'
import { addBpm, removeBpm, replaceBpm } from '../mutations/bpm'
import { getInStoreGrid } from '../store/grid'
import type { Transaction } from '../transaction'

export const editSelectedBpm = (
    transaction: Transaction,
    entity: BpmEntity,
    object: Partial<BpmObject>,
) => {
    const edited = {
        beat: object.beat ?? entity.beat,
        bpm: object.bpm ?? entity.bpm,
        meter: object.meter ?? entity.meter,
    }
    // Same-beat changes keep their order.
    if (edited.beat === entity.beat) return replaceBpm(transaction, entity, edited)

    removeBpm(transaction, entity)
    return addBpm(transaction, edited)
}

// A single move replaces its destination and preserves the initial BPM at zero.
// Batch property edits retain their existing remove-and-add semantics.
export const editBpm = (
    transaction: Transaction,
    entity: BpmEntity,
    object: Partial<BpmObject>,
) => {
    const beat = object.beat ?? entity.beat
    if (beat === entity.beat) return editSelectedBpm(transaction, entity, object)

    if (entity.beat) removeBpm(transaction, entity)
    const overlap = getInStoreGrid(transaction.store.grid, 'bpm', beat)?.find(
        (candidate) => candidate.beat === beat,
    )
    if (overlap) removeBpm(transaction, overlap)
    return addBpm(transaction, {
        beat,
        bpm: object.bpm ?? entity.bpm,
        meter: object.meter ?? entity.meter,
    })
}
