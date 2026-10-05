import type { Component, Ref } from 'vue'
import type { FolderId } from '../../../chart/folders'
import type { ScopeVisibility } from '../../scope'
import type { FolderOps } from './folders'
import type { OwnerKey } from './objects'

export type ManagerEntry<T> = {
    id: T
    name: string
}

/** The visibility API shared by `groupScope` and `stageScope`. */
export type ManagerScope<T> = {
    visibility: (id: T) => ScopeVisibility
    isShown: (id: T) => boolean
    setShown: (id: T, shown: boolean) => void
    /** Shows or hides several entries as one change, e.g. a folder's members. */
    setSomeShown: (ids: readonly T[], shown: boolean) => void
    /** Shows exactly these entries and hides the rest. */
    showOnly: (ids: readonly T[]) => void
    setAllShown: (shown: boolean) => void
    focus: (id: T | undefined) => void
    shownCount: Readonly<Ref<number>>
    totalCount: Readonly<Ref<number>>
}

export type ManagerStrings = {
    all: string
    showAll: string
    hideAll: string
    add: string
    properties: string
    moveUp: string
    moveDown: string
    delete: string
    deleteFolder: string
}

/** Everything a manager list needs to present and edit one collection. */
export type ManagerModel<T> = {
    entries: () => ManagerEntry<T>[]
    /** The authoring target and editing focus; `undefined` means all entries. */
    focused: () => T | undefined
    scope: ManagerScope<T>
    strings: () => ManagerStrings
    /**
     * Adds an entry, at the end or of a folder, without changing the authoring
     * target, and returns its id.
     */
    add: (folder?: FolderId) => T
    /** Steps an entry up or down, crossing folder edges one step at a time. */
    move: (id: T, offset: -1 | 1) => void
    /** Renames an entry; blank or unchanged names change nothing. */
    rename: (id: T, name: string) => void
    remove: (id: T) => void
    openProperties: (id: T) => void
    /** The object field that assigns notes and events to entries. */
    owner: OwnerKey
    folders: FolderOps<T>
}

/** A name as stored after renaming, or `undefined` when it is blank. */
export const normalizeName = (name: string) => name.trim() || undefined

/** A common entry action, shown inline on wide panels and in the menu. */
export type ManagerRowAction = {
    key: string
    label: string
    icon: Component
    disabled?: boolean
}
