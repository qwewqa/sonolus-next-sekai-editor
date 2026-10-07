import type { LevelDataEntity } from '@sonolus/core'
import type { FolderId } from '../../../chart/folders'
import type { StageId, Stages } from '../../../chart/stages'
import { serializeFolderRef } from './folder'

export const serializeStagesToLevelDataEntities = (
    isDynamicStages: boolean,
    stages: Stages,
    folderEntities?: ReadonlyMap<FolderId, LevelDataEntity>,
) => {
    if (!isDynamicStages) return

    return new Map(
        [...stages.entries()].map(([id, stage]): [StageId, LevelDataEntity] => [
            id,
            {
                archetype: 'Stage',
                data: [
                    {
                        name: 'editorName',
                        ref: stage.name,
                    },
                    {
                        name: 'fromStart',
                        value: +stage.isFromStart,
                    },
                    {
                        name: 'untilEnd',
                        value: +stage.isUntilEnd,
                    },
                    {
                        name: 'generateSimLines',
                        value: generateSimLines[stage.generateSimLines],
                    },
                    ...serializeFolderRef(folderEntities, stage.folderId),
                ],
            },
        ]),
    )
}

const generateSimLines = {
    global: 0,
    isolated: 1,
}
