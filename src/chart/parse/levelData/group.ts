import Type from 'typebox'
import { getOptionalRef, getOptionalValue, type ParseCtx } from '.'
import type { FolderId } from '../../folders'

export const parseGroupsToChart = ({ entities, addGroup, getGroupFolderId }: ParseCtx) => {
    for (const entity of entities) {
        if (entity.archetype !== '#TIMESCALE_GROUP') continue

        addGroup(entity.name, getOptionalRef(entity, 'editorName'), {
            forceNoteSpeed:
                // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
                getOptionalValue(entity, 'forceNoteSpeed', forceNoteSpeedSchema) || undefined,
            ...folderOf(getGroupFolderId(entity)),
        })
    }
}

const folderOf = (folderId: FolderId | undefined) => (folderId === undefined ? {} : { folderId })

const forceNoteSpeedSchema = Type.Union([Type.Literal(0), Type.Number({ minimum: 1, maximum: 12 })])
