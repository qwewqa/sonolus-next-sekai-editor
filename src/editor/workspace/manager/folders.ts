import { shallowReactive } from 'vue'
import {
    addToFolders,
    buildFolderTree,
    flattenFolderTree,
    folderOfEntry,
    insertFolderInTree,
    moveEntryInTree,
    moveFolderInTree,
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
}

/** Folder editing for one collection; every change is one undoable step. */
export type FolderOps<K> = ReturnType<typeof createFolderOps<K, FolderMember & { name: string }>>

export const createFolderOps = <K, V extends FolderMember & { name: string }>(config: {
    entries: () => ReadonlyMap<K, V>
    folders: () => Folders
    /** The state with these entries and folders. */
    withData: (state: State, entries: Map<K, V>, folders: Folders) => State
    /** The state without these entries and their objects, keeping at least one entry. */
    removeEntries: (ids: ReadonlySet<K>) => State
    entriesOf: (state: State) => ReadonlyMap<K, V>
    owner: OwnerKey
    strings: () => FolderStrings
}) => {
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

    /** "Folder 1", "Folder 2", … skipping names in use. */
    const newName = () => {
        const names = new Set([...config.folders().values()].map(({ name }) => name))
        for (let n = 1; ; n++) {
            const name = interpolateRaw(i18n.value.workspace.folders.defaultName, `${n}`)
            if (!names.has(name)) return name
        }
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
         * Adds a folder: at the end, or holding an entry where that entry was
         * (after the folder it leaves). Returns its id.
         */
        create(entry?: K) {
            const folders: Folders = new Map(config.folders())
            const name = newName()
            const id = addToFolders(folders, name)
            let next = tree()
            if (entry === undefined) {
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
                next = moveEntryInTree(next, entry, { folder: id }) ?? next
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

        /** Removes a folder, keeping its members where they are. */
        ungroup(id: FolderId) {
            const name = folderName(id)
            const folders: Folders = new Map(config.folders())
            folders.delete(id)
            collapsedFolders.delete(id)
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
    }
}
