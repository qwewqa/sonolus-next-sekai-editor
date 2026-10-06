import Type from 'typebox'
import { editorMetadataSchema } from '../../levelData/editorMetadata'
import { levelDataEntitiesSchema } from '../../levelData/entities/schema'

export const clipboardDataSchema = Type.Object({
    lane: Type.Number(),
    beat: Type.Number({ minimum: 0 }),
    entities: levelDataEntitiesSchema,
    ...editorMetadataSchema.properties,
    /** The copying chart and its group and stage ids, in the order the entities list them. */
    source: Type.Optional(
        Type.Object({
            chart: Type.String(),
            groups: Type.Array(Type.Number()),
            stages: Type.Optional(Type.Array(Type.Number())),
        }),
    ),
})

export type ClipboardData = Type.Static<typeof clipboardDataSchema>
