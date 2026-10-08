import Value from 'typebox/value'
import { restoreNullSegmentAlphas } from '../../levelData/parse'
import { clipboardDataSchema, type ClipboardData } from './schema'

export const parseClipboardData = (data: unknown): ClipboardData => {
    restoreNullSegmentAlphas(data)
    Value.Assert(clipboardDataSchema, data)
    return data
}
