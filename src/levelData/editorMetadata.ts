import type { LevelDataEntity } from '@sonolus/core'
import Type from 'typebox'
import type { Store } from '../state/store'

// Editor choices that cannot be represented in playable level data. Recovery
// and clipboard envelopes carry this alongside the level entities.
export const editorMetadataSchema = Type.Object({
    defaultGuideColors: Type.Optional(Type.Array(Type.Integer({ minimum: 0 }))),
})

export type EditorMetadata = Type.Static<typeof editorMetadataSchema>

export const serializeEditorMetadata = (
    entities: readonly LevelDataEntity[],
    store: Store,
): EditorMetadata => {
    // Level serialization emits notes in store.slides.info order. Record entity
    // indices because import can reorder standalone notes before named slides.
    const notes = [...store.slides.info.values()].flat()
    let noteIndex = 0
    const defaultGuideColors = entities.flatMap((entity, index) => {
        if (!entity.data.some(({ name }) => name === 'segmentKind')) return []
        const note = notes[noteIndex++]?.note
        return note?.connectorType === 'guide' && note.connectorStyle === 'default' ? [index] : []
    })
    return defaultGuideColors.length ? { defaultGuideColors } : {}
}
