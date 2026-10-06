import { storageRemove, storageSetText } from '../../storage'

/** Where a recovery this version cannot open is set aside, so new changes never replace it. */
export const unreadableRecoveryKey = 'autoSave.unreadable'

/** Sets the stored recovery aside; false when storage refused the copy. */
export const setRecoveryAside = (text: string) => {
    try {
        storageSetText(unreadableRecoveryKey, text)
    } catch {
        return false
    }
    storageRemove('autoSave.levelData')
    return true
}

/**
 * The recovery as a file to keep: the level file it wraps when that survives
 * (Open reads it in a version that can), otherwise the stored text as is.
 */
export const toRecoveryFile = (text: string): { blob: Blob; name: string } => {
    try {
        const data: unknown = JSON.parse(text)
        if (typeof data === 'object' && data !== null) {
            const name =
                'filename' in data && typeof data.filename === 'string' && data.filename
                    ? data.filename
                    : 'Recovery'
            if ('levelData' in data && typeof data.levelData === 'string') {
                const bytes = Uint8Array.from(atob(data.levelData), (c) => c.charCodeAt(0))
                // Gzip: the format Save writes.
                if (bytes[0] === 0x1f && bytes[1] === 0x8b)
                    return { blob: new Blob([bytes], { type: 'application/octet-stream' }), name }
            }
            if ('entities' in data)
                return {
                    blob: new Blob([text], { type: 'application/json' }),
                    name: `${name}.json`,
                }
        }
    } catch {
        // Damaged; kept as text below.
    }
    return { blob: new Blob([text], { type: 'text/plain' }), name: 'Recovery.txt' }
}
