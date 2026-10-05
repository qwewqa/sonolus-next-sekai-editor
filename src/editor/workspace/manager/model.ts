import type { Component, Ref } from 'vue'
import type { ScopeVisibility } from '../../scope'
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
}

/** Everything a manager list needs to present and edit one collection. */
export type ManagerModel<T> = {
    entries: () => ManagerEntry<T>[]
    /** The authoring target and editing focus; `undefined` means all entries. */
    focused: () => T | undefined
    scope: ManagerScope<T>
    strings: () => ManagerStrings
    /** Adds an entry without changing the authoring target and returns its id. */
    add: () => T
    move: (id: T, offset: -1 | 1) => void
    /** Moves an entry to an index of the list, as dragging does. */
    moveTo: (id: T, index: number) => void
    /** Renames an entry; blank or unchanged names change nothing. */
    rename: (id: T, name: string) => void
    remove: (id: T) => void
    openProperties: (id: T) => void
    /** The object field that assigns notes and events to entries. */
    owner: OwnerKey
}

/** Moves an entry to an index, or returns `undefined` when nothing changes. */
export const reorderEntries = <K, V>(map: ReadonlyMap<K, V>, id: K, index: number) => {
    const entries = [...map.entries()]
    const from = entries.findIndex(([key]) => key === id)
    const to = Math.max(0, Math.min(entries.length - 1, index))
    if (from === -1 || from === to) return

    const [entry] = entries.splice(from, 1)
    if (!entry) return
    entries.splice(to, 0, entry)

    return new Map(entries)
}

/** A name as stored after renaming, or `undefined` when it is blank. */
export const normalizeName = (name: string) => name.trim() || undefined

/** Swaps an entry with its neighbor, or returns `undefined` at a boundary. */
export const swapEntries = <K, V>(map: ReadonlyMap<K, V>, id: K, offset: -1 | 1) => {
    const entries = [...map.entries()]

    const aIndex = entries.findIndex(([key]) => key === id)
    const aEntry = entries[aIndex]
    if (!aEntry) return

    const bIndex = aIndex + offset
    const bEntry = entries[bIndex]
    if (!bEntry) return

    entries[aIndex] = bEntry
    entries[bIndex] = aEntry

    return new Map(entries)
}

/** A common entry action, shown inline on wide panels and in the menu. */
export type ManagerRowAction = {
    key: string
    label: string
    icon: Component
    disabled?: boolean
}
