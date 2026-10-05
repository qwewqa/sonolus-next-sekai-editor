/**
 * Folders organize groups and stages in the editor. They are editor-only:
 * level data carries them as entities and fields the engine never declares.
 *
 * Membership is a parent link (`folderId`) on each entry, the same link a
 * folder may carry for nesting in a later version. This version keeps one
 * level: folders hold entries, never folders.
 *
 * An entry map's order is the tree's depth-first order, so a folder's members
 * are always contiguous and every flat consumer (the default entry, next and
 * previous, paste mapping) sees the order the tree shows.
 */

/** Level data archetypes of folder entities, which the engine never declares. */
export const groupFolderArchetype = 'EditorGroupFolder'
export const stageFolderArchetype = 'EditorStageFolder'

declare const idBrand: unique symbol

export type FolderId = number & { [idBrand]: never }

export type FolderObject = {
    name: string
    /**
     * How many entries precede the folder in the flat order. It places a
     * folder without members; every change recomputes it.
     */
    index: number
    /** The containing folder, reserved for nesting; never set by this version. */
    folderId?: FolderId
}

export type Folders = Map<FolderId, FolderObject>

export type FolderMember = { folderId?: FolderId }

let i = 1

export const newFolderId = () => i++ as FolderId

/** One top-level item of the tree: a loose entry, or a folder and its members. */
export type FolderTreeItem<K> =
    { type: 'entry'; id: K } | { type: 'folder'; id: FolderId; members: K[] }

/** Where an item goes: before a top-level item, or at the end when omitted. */
export type FolderTreeRef<K> = { type: 'entry'; id: K } | { type: 'folder'; id: FolderId }

/**
 * Builds the tree from flat entries. A folder sits where its first member
 * does and gathers every member there; a folder without members sits at its
 * index. Links to missing folders count as none.
 */
export const buildFolderTree = <K, V extends FolderMember>(
    entries: ReadonlyMap<K, V>,
    folders: ReadonlyMap<FolderId, FolderObject>,
): FolderTreeItem<K>[] => {
    const members = new Map<FolderId, K[]>()
    for (const [id, { folderId }] of entries) {
        if (folderId === undefined || !folders.has(folderId)) continue
        const list = members.get(folderId)
        if (list) list.push(id)
        else members.set(folderId, [id])
    }

    const empties = [...folders]
        .filter(([id]) => !members.has(id))
        .map(([id, { index }]) => ({ id, index }))
        // Stable, so equal indices keep the folders' own order.
        .sort((a, b) => a.index - b.index)

    const items: FolderTreeItem<K>[] = []
    const placed = new Set<FolderId>()
    let position = 0
    const placeEmpties = (upTo: number) => {
        for (let next = empties[0]; next && next.index <= upTo; next = empties[0]) {
            empties.shift()
            items.push({ type: 'folder', id: next.id, members: [] })
        }
    }

    for (const [id, { folderId }] of entries) {
        placeEmpties(position)
        position++
        const list = folderId === undefined ? undefined : members.get(folderId)
        if (folderId === undefined || !list) {
            items.push({ type: 'entry', id })
        } else if (!placed.has(folderId)) {
            placed.add(folderId)
            items.push({ type: 'folder', id: folderId, members: list })
        }
    }
    placeEmpties(Infinity)

    return items
}

/**
 * Writes a tree back to flat maps: entries in depth-first order with their
 * folder links, and folders in tree order with fresh indices. Folders the
 * tree leaves out are dropped; entries it leaves out follow, loose, at the
 * end (e.g. one added while deleting the last).
 */
export const flattenFolderTree = <K, V extends FolderMember>(
    tree: readonly FolderTreeItem<K>[],
    entries: ReadonlyMap<K, V>,
    folders: ReadonlyMap<FolderId, FolderObject>,
) => {
    const newEntries = new Map<K, V>()
    const newFolders: Folders = new Map()

    const add = (id: K, folderId: FolderId | undefined) => {
        const value = entries.get(id)
        if (!value) return
        newEntries.set(id, withFolder(value, folderId))
    }

    for (const item of tree) {
        if (item.type === 'entry') {
            add(item.id, undefined)
            continue
        }
        const folder = folders.get(item.id)
        if (!folder) {
            for (const id of item.members) add(id, undefined)
            continue
        }
        newFolders.set(item.id, withIndex(folder, newEntries.size))
        for (const id of item.members) add(id, item.id)
    }
    for (const id of entries.keys()) {
        if (!newEntries.has(id)) add(id, undefined)
    }

    return { entries: newEntries, folders: newFolders }
}

const withFolder = <V extends FolderMember>(value: V, folderId: FolderId | undefined): V => {
    if (value.folderId === folderId) return value
    if (folderId !== undefined) return { ...value, folderId }
    const { folderId: _, ...rest } = value
    return rest as V
}

const withIndex = (folder: FolderObject, index: number): FolderObject =>
    folder.index === index ? folder : { ...folder, index }

/** Makes members contiguous and indices current, e.g. after loading. */
export const normalizeFolders = <K, V extends FolderMember>(
    entries: ReadonlyMap<K, V>,
    folders: ReadonlyMap<FolderId, FolderObject>,
) => flattenFolderTree(buildFolderTree(entries, folders), entries, folders)

/** The folder holding an entry, if any. */
export const folderOfEntry = <K>(tree: readonly FolderTreeItem<K>[], id: K) =>
    tree.find(
        (item): item is Extract<FolderTreeItem<K>, { type: 'folder' }> =>
            item.type === 'folder' && item.members.includes(id),
    )

const topIndexOf = <K>(tree: readonly FolderTreeItem<K>[], ref: FolderTreeRef<K>) =>
    tree.findIndex((item) => item.type === ref.type && item.id === ref.id)

const cloneTree = <K>(tree: readonly FolderTreeItem<K>[]): FolderTreeItem<K>[] =>
    tree.map((item) => (item.type === 'folder' ? { ...item, members: [...item.members] } : item))

const withoutEntry = <K>(tree: readonly FolderTreeItem<K>[], id: K) =>
    cloneTree(tree)
        .filter((item) => item.type !== 'entry' || item.id !== id)
        .map((item) =>
            item.type === 'folder'
                ? { ...item, members: item.members.filter((member) => member !== id) }
                : item,
        )

/**
 * Moves an entry: into a folder before one of its members (or at its end), or
 * to the top level before an item (or at the end). Returns `undefined` when
 * the place does not exist or nothing changes.
 */
export const moveEntryInTree = <K>(
    tree: readonly FolderTreeItem<K>[],
    id: K,
    place: { folder: FolderId; before?: K } | { folder?: undefined; before?: FolderTreeRef<K> },
): FolderTreeItem<K>[] | undefined => {
    const next = withoutEntry(tree, id)
    if (place.folder !== undefined) {
        const folder = next.find(
            (item): item is Extract<FolderTreeItem<K>, { type: 'folder' }> =>
                item.type === 'folder' && item.id === place.folder,
        )
        if (!folder) return
        const at = place.before === undefined ? -1 : folder.members.indexOf(place.before)
        folder.members.splice(at === -1 ? folder.members.length : at, 0, id)
    } else {
        const at = place.before === undefined ? -1 : topIndexOf(next, place.before)
        if (place.before !== undefined && at === -1) return
        next.splice(at === -1 ? next.length : at, 0, { type: 'entry', id })
    }
    return sameTree(tree, next) ? undefined : next
}

/** Moves a folder with its members before a top-level item, or to the end. */
export const moveFolderInTree = <K>(
    tree: readonly FolderTreeItem<K>[],
    folderId: FolderId,
    before?: FolderTreeRef<K>,
): FolderTreeItem<K>[] | undefined => {
    const from = topIndexOf(tree, { type: 'folder', id: folderId })
    const item = tree[from]
    if (!item) return
    if (before?.type === 'folder' && before.id === folderId) return
    const next = cloneTree(tree)
    next.splice(from, 1)
    const at = before === undefined ? -1 : topIndexOf(next, before)
    if (before !== undefined && at === -1) return
    next.splice(at === -1 ? next.length : at, 0, item)
    return sameTree(tree, next) ? undefined : next
}

/**
 * Moves an entry one step, crossing folder edges one step at a time: up from
 * a folder's first member leaves it above the folder, and a loose entry
 * stepping onto an expanded folder enters it at that end. Collapsed folders
 * are stepped over whole. Returns `undefined` at the ends.
 */
export const stepEntryInTree = <K>(
    tree: readonly FolderTreeItem<K>[],
    id: K,
    offset: -1 | 1,
    isExpanded: (folderId: FolderId) => boolean = () => true,
): FolderTreeItem<K>[] | undefined => {
    const folder = folderOfEntry(tree, id)
    if (folder) {
        const index = folder.members.indexOf(id)
        const neighbor = folder.members[index + offset]
        if (neighbor !== undefined)
            return moveEntryInTree(tree, id, {
                folder: folder.id,
                before: offset < 0 ? neighbor : folder.members[index + 2],
            })
        // Leave the folder on the side it was moving toward.
        const top = topIndexOf(tree, { type: 'folder', id: folder.id })
        const after = tree[top + 1]
        return moveEntryInTree(tree, id, {
            before: offset < 0 ? { type: 'folder', id: folder.id } : refOf(after),
        })
    }

    const top = topIndexOf(tree, { type: 'entry', id })
    const neighbor = tree[top + offset]
    if (!neighbor) return
    if (neighbor.type === 'folder' && isExpanded(neighbor.id))
        return moveEntryInTree(tree, id, {
            folder: neighbor.id,
            before: offset < 0 ? undefined : neighbor.members[0],
        })
    return moveEntryInTree(tree, id, {
        before: offset < 0 ? refOf(neighbor) : refOf(tree[top + 2]),
    })
}

/** Swaps a folder with its top-level neighbor, or returns `undefined` at the ends. */
export const stepFolderInTree = <K>(
    tree: readonly FolderTreeItem<K>[],
    folderId: FolderId,
    offset: -1 | 1,
): FolderTreeItem<K>[] | undefined => {
    const top = topIndexOf(tree, { type: 'folder', id: folderId })
    if (top === -1 || !tree[top + offset]) return
    return moveFolderInTree(
        tree,
        folderId,
        offset < 0 ? refOf(tree[top - 1]) : refOf(tree[top + 2]),
    )
}

/** Removes a folder, leaving its members loose where it was. */
export const ungroupInTree = <K>(
    tree: readonly FolderTreeItem<K>[],
    folderId: FolderId,
): FolderTreeItem<K>[] =>
    tree.flatMap((item) =>
        item.type === 'folder' && item.id === folderId
            ? item.members.map((id) => ({ type: 'entry' as const, id }))
            : [item],
    )

/** Adds an empty folder before a top-level item, or at the end. */
export const insertFolderInTree = <K>(
    tree: readonly FolderTreeItem<K>[],
    folderId: FolderId,
    before?: FolderTreeRef<K>,
): FolderTreeItem<K>[] => {
    const next = cloneTree(tree)
    const at = before === undefined ? -1 : topIndexOf(next, before)
    next.splice(at === -1 ? next.length : at, 0, { type: 'folder', id: folderId, members: [] })
    return next
}

const refOf = <K>(item: FolderTreeItem<K> | undefined): FolderTreeRef<K> | undefined =>
    item &&
    (item.type === 'entry' ? { type: 'entry', id: item.id } : { type: 'folder', id: item.id })

const sameTree = <K>(a: readonly FolderTreeItem<K>[], b: readonly FolderTreeItem<K>[]) =>
    a.length === b.length &&
    a.every((item, index) => {
        const other = b[index]
        if (other?.type !== item.type || other.id !== item.id) return false
        if (item.type === 'entry' || other.type === 'entry') return true
        return (
            item.members.length === other.members.length &&
            item.members.every((id, member) => other.members[member] === id)
        )
    })

/** Drops entries from a tree, e.g. after deleting them. */
export const removeEntriesFromTree = <K>(
    tree: readonly FolderTreeItem<K>[],
    ids: ReadonlySet<K>,
): FolderTreeItem<K>[] =>
    tree.flatMap((item): FolderTreeItem<K>[] => {
        if (item.type === 'folder')
            return [{ ...item, members: item.members.filter((id) => !ids.has(id)) }]
        return ids.has(item.id) ? [] : [item]
    })

/** Drops a folder with its members from a tree. */
export const removeFolderFromTree = <K>(
    tree: readonly FolderTreeItem<K>[],
    folderId: FolderId,
): FolderTreeItem<K>[] => tree.filter((item) => item.type !== 'folder' || item.id !== folderId)

/** Adds a folder object without placing it; callers place it in a tree. */
export const addToFolders = (folders: Folders, name: string, index = 0) => {
    const id = newFolderId()
    folders.set(id, { name, index })
    return id
}

/** A run of a displayed name: template text, or the folder or entry name it holds. */
export type NamePart = { text: string; role?: 'folder' | 'name' }

/** Fills a template's `{n}` placeholders with runs of parts, keeping its own text. */
export const templateParts = (
    template: string,
    values: readonly (readonly NamePart[])[],
): NamePart[] =>
    template.split(/(\{\d+\})/).flatMap((piece) => {
        const match = /^\{(\d+)\}$/.exec(piece)
        if (match) return [...(values[Number(match[1])] ?? [])]
        return piece ? [{ text: piece }] : []
    })

/**
 * An entry's name led by its folder's through a path template such as
 * "{0} › {1}", as parts, so a display can shorten the folder before the name.
 */
export const folderPathParts = <K, V extends FolderMember & { name: string }>(
    entries: ReadonlyMap<K, V>,
    folders: ReadonlyMap<FolderId, FolderObject>,
    id: K,
    path: string,
): NamePart[] => {
    const entry = entries.get(id)
    if (!entry) return []
    const name: NamePart[] = [{ text: entry.name, role: 'name' }]
    const folder = entry.folderId === undefined ? undefined : folders.get(entry.folderId)
    return folder ? templateParts(path, [[{ text: folder.name, role: 'folder' }], name]) : name
}

/** Picker options in tree order: loose entries as they come, each folder as a labeled section. */
export const folderSections = <K, V extends FolderMember & { name: string }>(
    entries: ReadonlyMap<K, V>,
    folders: ReadonlyMap<FolderId, FolderObject>,
) => {
    const sections: { label?: string; options: [string, K][] }[] = []
    const option = (id: K): [string, K] => [entries.get(id)?.name ?? '', id]
    for (const item of buildFolderTree(entries, folders)) {
        if (item.type === 'folder') {
            if (item.members.length)
                sections.push({
                    label: folders.get(item.id)?.name ?? '',
                    options: item.members.map(option),
                })
            continue
        }
        const last = sections.at(-1)
        if (last && last.label === undefined) last.options.push(option(item.id))
        else sections.push({ options: [option(item.id)] })
    }
    return sections
}
