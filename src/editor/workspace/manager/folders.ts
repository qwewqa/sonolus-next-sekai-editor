import { shallowReactive } from 'vue'
import {
    addToFolders,
    buildFolderTree,
    copyName,
    entriesInTreeOrder,
    flattenFolderTree,
    folderOfEntry,
    insertCopiesInTree,
    insertFolderInTree,
    moveEntriesInTree,
    moveEntryInTree,
    moveFolderInTree,
    numberedName,
    removeEntriesFromTree,
    removeFolderFromTree,
    stepEntryInTree,
    stepFolderInTree,
    ungroupInTree,
    type FolderId,
    type FolderMember,
    type Folders,
    type FolderTreeItem,
    type FolderTreeRef,
} from '../../../chart/folders'
import { pushState, state } from '../../../history'
import { onResetState } from '../../../history/resetHooks'
import { i18n } from '../../../i18n'
import { showModal } from '../../../modals'
import ConfirmModal from '../../../modals/ConfirmModal.vue'
import type { State } from '../../../state'
import { interpolate, interpolateRaw } from '../../../utils/interpolate'
import { notify } from '../../notification'
import { view } from '../../view'
import { normalizeName } from './model'
import { ownedCounts, type OwnerKey } from './objects'

/**
 * Collapsed folders. Collapsing is a view choice, never an edit: it stays out
 * of history and the file, and a new chart starts with every folder open.
 * Removed folders stay listed, so an undo brings them back as they were.
 */
export const collapsedFolders = shallowReactive(new Set<FolderId>())

onResetState(() => {
    collapsedFolders.clear()
})

export const isFolderExpanded = (id: FolderId) => !collapsedFolders.has(id)

export const setFolderExpanded = (id: FolderId, expanded: boolean) => {
    if (expanded) collapsedFolders.delete(id)
    else collapsedFolders.add(id)
}

/** Where an entry goes: in a folder before a member (or at its end), or loose. */
export type EntryPlace<K> =
    { folder: FolderId; before?: K } | { folder?: undefined; before?: FolderTreeRef<K> }

export type FolderStrings = {
    /** Moving an entry within its folder or the top level. */
    movedEntry: string
    deleteFolderTitle: string
    deleteFolderMessage: string
    /** Moving selected entries ({0}: their count) into a folder ({1}), or out. */
    movedSelectedInto: string
    movedSelectedOut: string
    /** Duplicating an entry ({0}: its name), or several ({0}: their count). */
    duplicated: string
    duplicatedSelected: string
    /** Duplicating selected folders ({0}: their count) and entries ({1}: all copied). */
    duplicatedSelectedFolders: string
    /** Deleting selected entries ({0}: their count), or folders ({0}) and entries ({1}). */
    deletedSelected: string
    deletedSelectedFolders: string
}

/** Folder editing for one collection; every change is one undoable step. */
export type FolderOps<K> = ReturnType<typeof createFolderOps<K, FolderMember & { name: string }>>

// A declaration, so groups and stages can build their ops while this module is still loading.
export function createFolderOps<K, V extends FolderMember & { name: string }>(config: {
    entries: () => ReadonlyMap<K, V>
    folders: () => Folders
    /** The state with these entries and folders. */
    withData: (state: State, entries: Map<K, V>, folders: Folders) => State
    /** The state without these entries and their objects, keeping at least one entry. */
    removeEntries: (ids: ReadonlySet<K>) => State
    entriesOf: (state: State) => ReadonlyMap<K, V>
    /** Adds an entry with this name and data to the map, returning its id. */
    addEntry: (entries: Map<K, V>, name: string, value: V) => K
    /** The state with copies of these entries' objects, owned by their copies. */
    duplicateObjects: (state: State, copies: ReadonlyMap<K, K>) => State
    owner: OwnerKey
    strings: () => FolderStrings
}) {
    const tree = () => buildFolderTree(config.entries(), config.folders())

    const nameOf = (id: K) => config.entries().get(id)?.name ?? ''
    const folderName = (id: FolderId) => config.folders().get(id)?.name ?? ''

    const commit = (
        next: readonly FolderTreeItem<K>[],
        message: () => string,
        folders: Folders = config.folders(),
        base: State = state.value,
    ) => {
        const flat = flattenFolderTree(next, config.entriesOf(base), folders)
        pushState(message, config.withData(base, flat.entries, flat.folders))
        notify(message)
    }

    /** "#1", "#2", … as new groups and stages are named. */
    const newName = () => numberedName([...config.folders().values()].map(({ name }) => name))

    /**
     * Copies entries and folders with their objects in one step. Copies of the
     * copied folders' members go in the folder copies and keep their names.
     */
    const duplicateIn = (
        ids: readonly K[],
        message: (copies: ReadonlyMap<K, K>) => () => string,
        folderCopies: ReadonlyMap<FolderId, FolderId> = new Map(),
        folders: Folders = config.folders(),
    ) => {
        const entries = new Map(config.entries())
        const taken = new Set([...entries.values()].map(({ name }) => name))
        const kept = new Set([...folderCopies.keys()].flatMap(members))
        const copies = new Map<K, K>()
        for (const id of entriesInTreeOrder(tree())) {
            if (!kept.has(id) && !ids.includes(id)) continue
            const value = entries.get(id)
            if (!value) continue
            const name = kept.has(id)
                ? value.name
                : copyName(value.name, taken, i18n.value.workspace.manager.copyName)
            taken.add(name)
            copies.set(id, config.addEntry(entries, name, value))
        }
        const base = config.duplicateObjects(
            config.withData(state.value, entries, config.folders()),
            copies,
        )
        commit(insertCopiesInTree(tree(), copies, folderCopies), message(copies), folders, base)
        return copies
    }

    /** Adds copies of folders to the map, named as copies, returning them by source. */
    const copyFolders = (folders: Folders, ids: readonly FolderId[]) => {
        const names = new Set([...folders.values()].map(({ name }) => name))
        const copies = new Map<FolderId, FolderId>()
        for (const id of ids) {
            const folder = folders.get(id)
            if (!folder) continue
            const name = copyName(folder.name, names, i18n.value.workspace.manager.copyName)
            names.add(name)
            copies.set(id, addToFolders(folders, name))
        }
        return copies
    }

    const members = (id: FolderId) =>
        tree().find(
            (item): item is Extract<FolderTreeItem<K>, { type: 'folder' }> =>
                item.type === 'folder' && item.id === id,
        )?.members ?? []

    return {
        tree,
        members,
        name: folderName,

        /**
         * Adds a folder: at the end, or holding entries where the first of them
         * was (after the folder it leaves). Returns its id.
         */
        create(held?: ReadonlySet<K>) {
            const folders: Folders = new Map(config.folders())
            const name = newName()
            const id = addToFolders(folders, name)
            let next = tree()
            const entry = held && entriesInTreeOrder(next).find((id) => held.has(id))
            if (!held || entry === undefined) {
                next = insertFolderInTree(next, id)
            } else {
                const holder = folderOfEntry(next, entry)
                const at = next.findIndex((item) =>
                    holder
                        ? item.type === 'folder' && item.id === holder.id
                        : item.type === 'entry' && item.id === entry,
                )
                const after = next[at + (holder ? 1 : 0)]
                next = insertFolderInTree(
                    next,
                    id,
                    after && ({ type: after.type, id: after.id } as FolderTreeRef<K>),
                )
                next = moveEntriesInTree(next, held, id) ?? next
            }
            commit(
                next,
                interpolate(() => i18n.value.workspace.folders.added, name),
                folders,
            )
            return id
        },

        rename(id: FolderId, value: string) {
            const folder = config.folders().get(id)
            const name = normalizeName(value)
            if (!folder || !name || name === folder.name) return
            const folders: Folders = new Map(config.folders())
            folders.set(id, { ...folder, name })
            commit(
                tree(),
                interpolate(() => i18n.value.workspace.folders.renamed, folder.name, name),
                folders,
            )
        },

        /** Moves an entry into, within or out of folders. */
        placeEntry(id: K, place: EntryPlace<K>) {
            const from = folderOfEntry(tree(), id)?.id
            const next = moveEntryInTree(tree(), id, place)
            if (!next) return
            const name = nameOf(id)
            const to = place.folder
            const message =
                to !== undefined && to !== from
                    ? interpolate(
                          () => i18n.value.workspace.folders.movedInto,
                          name,
                          folderName(to),
                      )
                    : place.folder === undefined && from !== undefined
                      ? interpolate(
                            () => i18n.value.workspace.folders.movedOut,
                            name,
                            folderName(from),
                        )
                      : interpolate(() => config.strings().movedEntry, name)
            commit(next, message)
        },

        /** Moves entries to a folder's end, or out of their folders, as one step; those already there stay put. */
        placeEntries(ids: ReadonlySet<K>, folder: FolderId | undefined) {
            const before = tree()
            const next = moveEntriesInTree(before, ids, folder)
            if (!next) return
            const count = `${[...ids].filter((id) => folderOfEntry(before, id)?.id !== folder).length}`
            commit(
                next,
                folder === undefined
                    ? interpolate(() => config.strings().movedSelectedOut, count)
                    : interpolate(
                          () => config.strings().movedSelectedInto,
                          count,
                          folderName(folder),
                      ),
            )
        },

        /** Steps an entry, crossing folder edges; collapsed folders are passed whole. */
        stepEntry(id: K, offset: -1 | 1) {
            const from = folderOfEntry(tree(), id)?.id
            const next = stepEntryInTree(tree(), id, offset, isFolderExpanded)
            if (!next) return
            const to = folderOfEntry(next, id)?.id
            const name = nameOf(id)
            commit(
                next,
                to !== undefined && to !== from
                    ? interpolate(
                          () => i18n.value.workspace.folders.movedInto,
                          name,
                          folderName(to),
                      )
                    : to === undefined && from !== undefined
                      ? interpolate(
                            () => i18n.value.workspace.folders.movedOut,
                            name,
                            folderName(from),
                        )
                      : interpolate(() => config.strings().movedEntry, name),
            )
        },

        canStepEntry: (id: K, offset: -1 | 1) =>
            !!stepEntryInTree(tree(), id, offset, isFolderExpanded),

        placeFolder(id: FolderId, before?: FolderTreeRef<K>) {
            const next = moveFolderInTree(tree(), id, before)
            if (!next) return
            commit(
                next,
                interpolate(() => i18n.value.workspace.folders.moved, folderName(id)),
            )
        },

        stepFolder(id: FolderId, offset: -1 | 1) {
            const next = stepFolderInTree(tree(), id, offset)
            if (!next) return
            commit(
                next,
                interpolate(() => i18n.value.workspace.folders.moved, folderName(id)),
            )
        },

        canStepFolder: (id: FolderId, offset: -1 | 1) => !!stepFolderInTree(tree(), id, offset),

        /** Duplicates entries with their objects; returns the copies in order. */
        duplicate(ids: ReadonlySet<K>): K[] {
            const sources = entriesInTreeOrder(tree()).filter((id) => ids.has(id))
            if (!sources.length) return []
            const copies = duplicateIn(sources, (copies) =>
                copies.size === 1
                    ? interpolate(() => config.strings().duplicated, nameOf(sources[0] as K))
                    : interpolate(() => config.strings().duplicatedSelected, `${copies.size}`),
            )
            return sources.flatMap((id) => {
                const copy = copies.get(id)
                return copy === undefined ? [] : [copy]
            })
        },

        /** Duplicates a folder with its members and their objects; returns the copy. */
        duplicateFolder(id: FolderId) {
            const name = folderName(id)
            const folders: Folders = new Map(config.folders())
            const copies = copyFolders(folders, [id])
            const copy = copies.get(id)
            if (copy === undefined) return
            duplicateIn(
                [],
                () => interpolate(() => i18n.value.workspace.folders.duplicated, name),
                copies,
                folders,
            )
            return copy
        },

        /**
         * Duplicates entries and whole folders as one step, each copy after its
         * source; returns the entry copies in order and the folder copies.
         */
        duplicateMany(ids: readonly K[], folderIds: readonly FolderId[]) {
            const folders: Folders = new Map(config.folders())
            const folderCopies = copyFolders(folders, folderIds)
            const sources = entriesInTreeOrder(tree()).filter((id) => ids.includes(id))
            if (!sources.length && !folderCopies.size) return { entries: [], folders: [] }
            const [only] = folderCopies.keys()
            const message = (copies: ReadonlyMap<K, K>) =>
                !folderCopies.size && copies.size === 1
                    ? interpolate(() => config.strings().duplicated, nameOf(sources[0] as K))
                    : !folderCopies.size
                      ? interpolate(() => config.strings().duplicatedSelected, `${copies.size}`)
                      : !sources.length && folderCopies.size === 1 && only !== undefined
                        ? interpolate(
                              () => i18n.value.workspace.folders.duplicated,
                              folderName(only),
                          )
                        : interpolate(
                              () => config.strings().duplicatedSelectedFolders,
                              `${folderCopies.size}`,
                              `${copies.size}`,
                          )
            const copies = new Set(duplicateIn(sources, message, folderCopies, folders).values())
            return {
                entries: entriesInTreeOrder(tree()).filter((id) => copies.has(id)),
                folders: [...folderCopies.values()],
            }
        },

        /** Removes a folder, keeping its members where they are. */
        ungroup(id: FolderId) {
            const name = folderName(id)
            const folders: Folders = new Map(config.folders())
            folders.delete(id)
            commit(
                ungroupInTree(tree(), id),
                interpolate(() => i18n.value.workspace.folders.ungrouped, name),
                folders,
            )
        },

        /** Deletes a folder with its members and their objects, after confirming. */
        async remove(id: FolderId) {
            const name = folderName(id)
            const ids = new Set(members(id))
            if (ids.size) {
                const confirmed = await showModal(ConfirmModal, {
                    title: () => config.strings().deleteFolderTitle,
                    message: () =>
                        interpolateRaw(
                            config.strings().deleteFolderMessage,
                            name,
                            `${ids.size}`,
                            `${[...ids].reduce(
                                (sum, member) =>
                                    sum +
                                    (ownedCounts(config.owner).get(member as unknown as number) ??
                                        0),
                                0,
                            )}`,
                        ),
                    confirm: () => i18n.value.modals.confirm.delete,
                    destructive: true,
                })
                if (!confirmed || !config.folders().has(id)) return
            }
            const next = removeEntriesFromTree(removeFolderFromTree(tree(), id), ids)
            const base = ids.size ? config.removeEntries(ids) : state.value
            const folders: Folders = new Map(config.folders())
            folders.delete(id)
            commit(
                next,
                interpolate(() => i18n.value.workspace.folders.deleted, name),
                folders,
                base,
            )
            if (ids.size)
                view.entities = {
                    hovered: [],
                    creating: [],
                }
        },

        /** The state with an entry moved to the end of a folder, as part of another edit. */
        placedIn(base: State, id: K, folder: FolderId): State {
            const entries = config.entriesOf(base)
            const next = moveEntryInTree(buildFolderTree(entries, config.folders()), id, {
                folder,
            })
            if (!next) return base
            const flat = flattenFolderTree(next, entries, config.folders())
            return config.withData(base, flat.entries, flat.folders)
        },

        /** Drops deleted entries from the tree, keeping folders in place. */
        commitRemoval(ids: ReadonlySet<K>, base: State, message: () => string) {
            commit(removeEntriesFromTree(tree(), ids), message, config.folders(), base)
        },

        /**
         * Deletes entries with their objects, and folders, as one step, keeping
         * at least one entry. A deleted folder's members are among the entries.
         */
        removeMany(entryIds: ReadonlySet<K>, folderIds: ReadonlySet<FolderId> = new Set()) {
            const ids = new Set([...entryIds].filter((id) => config.entries().has(id)))
            const gone = new Set([...folderIds].filter((id) => config.folders().has(id)))
            if (!ids.size && !gone.size) return
            const [only] = gone
            const name = only === undefined ? '' : folderName(only)
            const message = !gone.size
                ? interpolate(() => config.strings().deletedSelected, `${ids.size}`)
                : gone.size === 1 && only !== undefined && members(only).length === ids.size
                  ? interpolate(() => i18n.value.workspace.folders.deleted, name)
                  : interpolate(
                        () => config.strings().deletedSelectedFolders,
                        `${gone.size}`,
                        `${ids.size}`,
                    )
            const folders: Folders = new Map(config.folders())
            for (const id of gone) folders.delete(id)
            commit(
                removeEntriesFromTree(tree(), ids).filter(
                    (item) => item.type !== 'folder' || !gone.has(item.id),
                ),
                message,
                folders,
                ids.size ? config.removeEntries(ids) : state.value,
            )
        },
    }
}
