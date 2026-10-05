import type { LevelDataEntity } from '@sonolus/core'
import type { FolderId } from '../../../chart/folders'
import type { GroupId, Groups } from '../../../chart/groups'
import { serializeFolderRef } from './folder'

export const serializeGroupsToLevelDataEntities = (
    groups: Groups,
    folderEntities?: ReadonlyMap<FolderId, LevelDataEntity>,
) =>
    new Map(
        [...groups.entries()].map(
            ([id, { name, forceNoteSpeed, folderId }]): [GroupId, LevelDataEntity] => [
                id,
                {
                    archetype: '#TIMESCALE_GROUP',
                    data: [
                        {
                            name: 'editorName',
                            ref: name,
                        },
                        ...(forceNoteSpeed
                            ? [
                                  {
                                      name: 'forceNoteSpeed',
                                      value: forceNoteSpeed,
                                  },
                              ]
                            : []),
                        ...serializeFolderRef(folderEntities, folderId),
                    ],
                },
            ],
        ),
    )
