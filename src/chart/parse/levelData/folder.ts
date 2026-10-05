import Type from 'typebox'
import { getOptionalRef, getOptionalValue, type ParseCtx } from '.'
import { addToFolders, type FolderId, type Folders } from '../../folders'

/**
 * Reads editor-only folder entities. Returns each folder entity's id by its
 * entity name. This version shows one level, so a folder nested in another
 * (written by a later version) resolves to its top-level ancestor, whose
 * members it joins; no entry is lost.
 */
export const parseFoldersToChart = (
    { entities }: Pick<ParseCtx, 'entities'>,
    archetype: string,
    folders: Folders,
): Map<string, FolderId> => {
    const found = new Map<string, { name?: string; index: number; parent?: string }>()
    for (const entity of entities) {
        if (entity.archetype !== archetype || !entity.name) continue
        found.set(entity.name, {
            name: getOptionalRef(entity, 'editorName'),
            index: getOptionalValue(entity, 'editorIndex', indexSchema) ?? Infinity,
            parent: getOptionalRef(entity, 'editorFolder'),
        })
    }

    // The outermost folder; a cycle (which no version writes) is rooted at its
    // first folder in entity order, so its members are still kept.
    const order = [...found.keys()]
    const topOf = (name: string) => {
        const path: string[] = []
        let current = name
        for (;;) {
            path.push(current)
            const parent = found.get(current)?.parent
            if (parent === undefined || !found.has(parent)) return current
            const loop = path.indexOf(parent)
            if (loop !== -1)
                return path
                    .slice(loop)
                    .reduce((a, b) => (order.indexOf(a) <= order.indexOf(b) ? a : b))
            current = parent
        }
    }

    const ids = new Map<string, FolderId>()
    for (const [name, folder] of found) {
        if (topOf(name) !== name) continue
        ids.set(name, addToFolders(folders, folder.name ?? name, folder.index))
    }
    for (const name of found.keys()) {
        const id = ids.get(topOf(name))
        if (id !== undefined) ids.set(name, id)
    }

    return ids
}

const indexSchema = Type.Number({ minimum: 0 })
