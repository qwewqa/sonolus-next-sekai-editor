import { i18n } from '../i18n'
import { numberedName, type FolderId } from './folders'

export type Groups = Map<GroupId, GroupObject>

declare const idBrand: unique symbol

export type GroupId = number & { [idBrand]: never }

export type GroupObject = {
    name: string
    forceNoteSpeed?: number
    /** The folder holding the group; see `./folders`. */
    folderId?: FolderId
}

let i = 1

export const addToGroups = (
    groups: Groups,
    name?: string,
    object: Omit<GroupObject, 'name'> = {},
) => {
    // Restored charts can already contain the next id; adding must never replace a group.
    while (groups.has(i as GroupId)) i++
    const id = i++ as GroupId
    // A blank name, e.g. from level data, gets a default like a missing one.
    if (!name?.trim()) name = undefined
    name ??= groups.size
        ? numberedName([...groups.values()].map(({ name }) => name))
        : i18n.value.group.default

    groups.set(id, {
        name,
        ...object,
    })

    return [id, name] as const
}
