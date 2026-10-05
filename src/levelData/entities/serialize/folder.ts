import type { LevelDataEntity } from '@sonolus/core'
import type { FolderId, Folders } from '../../../chart/folders'

/**
 * Editor-only folder entities. The engine declares no such archetype, so
 * Sonolus ignores them; members link to them by `editorFolder` refs.
 */
export const serializeFoldersToLevelDataEntities = (
    archetype: string,
    folders: Folders,
    getName: () => string,
) =>
    new Map(
        [...folders].map(([id, folder]): [FolderId, LevelDataEntity] => [
            id,
            {
                archetype,
                name: getName(),
                data: [
                    { name: 'editorName', ref: folder.name },
                    { name: 'editorIndex', value: folder.index },
                ],
            },
        ]),
    )

/** The member's link to its folder entity, when it has one. */
export const serializeFolderRef = (
    folderEntities: ReadonlyMap<FolderId, LevelDataEntity> | undefined,
    folderId: FolderId | undefined,
) => {
    const name = folderId === undefined ? undefined : folderEntities?.get(folderId)?.name
    return name === undefined ? [] : [{ name: 'editorFolder', ref: name }]
}
