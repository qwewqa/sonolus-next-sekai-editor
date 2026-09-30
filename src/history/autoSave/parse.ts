import type { LevelData } from '@sonolus/core'
import { ungzip } from 'pako'
import Value from 'typebox/value'
import { parseLevelData } from '../../levelData/parse'
import { autoSaveSchema } from './schema'

type ParsedAutoSave = {
    filename?: string
    levelData: LevelData
}

export const parseAutoSave = (data: unknown): ParsedAutoSave => {
    Value.Assert(autoSaveSchema, data)

    if (!('version' in data))
        return {
            levelData: data,
        }

    const buffer = Uint8Array.from(atob(data.levelData), (c) => c.charCodeAt(0))

    return {
        filename: data.filename,
        levelData: parseLevelData(JSON.parse(new TextDecoder().decode(ungzip(buffer)))),
    }
}
