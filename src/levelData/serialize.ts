import type { LevelData } from '@sonolus/core'
import type { Folders } from '../chart/folders'
import type { Groups } from '../chart/groups'
import type { Stages } from '../chart/stages'
import type { Store } from '../state/store'
import { serializeToLevelDataEntities } from './entities/serialize'

export const serializeToLevelData = (
    initialLife: number,
    isDynamicStages: boolean,
    bgmOffset: number,
    store: Store,
    groups: Groups,
    stages: Stages,
    folders?: { groups: Folders; stages: Folders },
): LevelData => ({
    bgmOffset,
    entities: serializeToLevelDataEntities(
        initialLife,
        isDynamicStages,
        store,
        groups,
        stages,
        folders,
    ),
})
