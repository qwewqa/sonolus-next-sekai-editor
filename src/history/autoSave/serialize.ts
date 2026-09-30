import type { LevelData } from '@sonolus/core'
import { gzip } from 'pako'
import type { EditorMetadata } from '../../levelData/editorMetadata'
import type { AutoSave } from './schema'

export const serializeAutoSave = (
    levelData: LevelData,
    filename?: string,
    metadata: EditorMetadata = {},
): AutoSave => {
    const buffer = gzip(JSON.stringify(levelData), {
        level: 9,
    })
    const chunks: string[] = []
    for (let offset = 0; offset < buffer.length; offset += 0x8000) {
        chunks.push(String.fromCharCode(...buffer.subarray(offset, offset + 0x8000)))
    }

    return {
        version: 1,
        filename,
        levelData: btoa(chunks.join('')),
        ...metadata,
    }
}
