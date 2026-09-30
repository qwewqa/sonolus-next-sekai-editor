import Type from 'typebox'
import { editorMetadataSchema } from '../../levelData/editorMetadata'
import { levelDataSchema } from '../../levelData/schema'

const v1Schema = Type.Object({
    version: Type.Literal(1),
    filename: Type.Optional(Type.String()),
    levelData: Type.String(),
    ...editorMetadataSchema.properties,
})

export const autoSaveSchema = Type.Union([v1Schema, levelDataSchema])

export type AutoSave = Type.Static<typeof v1Schema>
