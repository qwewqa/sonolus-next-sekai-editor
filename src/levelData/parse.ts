import type { LevelData } from '@sonolus/core'
import Value from 'typebox/value'
import { levelDataSchema } from './schema'

export const parseLevelData = (data: unknown): LevelData => {
    restoreNullSegmentAlphas(data)
    Value.Assert(levelDataSchema, data)
    return data
}

/** Older editors saved a one-note SUS guide's NaN alpha as null; it loads as 1. */
export const restoreNullSegmentAlphas = (data: unknown) => {
    if (typeof data !== 'object' || data === null || !('entities' in data)) return
    if (!Array.isArray(data.entities)) return

    for (const entity of data.entities as unknown[]) {
        if (typeof entity !== 'object' || entity === null || !('data' in entity)) continue
        if (!Array.isArray(entity.data)) continue

        for (const item of entity.data as unknown[]) {
            if (typeof item !== 'object' || item === null) continue
            if (!('name' in item) || item.name !== 'segmentAlpha') continue
            if (!('value' in item) || item.value !== null) continue

            item.value = 1
        }
    }
}
