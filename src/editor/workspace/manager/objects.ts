import { computed } from 'vue'
import { replaceState, state } from '../../../history'
import { selectedEntities } from '../../../history/selectedEntities'
import { store } from '../../../history/store'
import { i18n } from '../../../i18n'
import type { Entity } from '../../../state/entities'
import type { Store } from '../../../state/store'
import { interpolate } from '../../../utils/interpolate'
import { notify } from '../../notification'
import { scopeLookup } from '../../scope'
import { entityScopeVisibility } from '../../scopeRules'

/** Which entity field assigns an object to a group or a stage. */
export type OwnerKey = 'groupId' | 'stageId'

const ownedTypes = {
    groupId: ['note', 'timeScale'],
    stageId: [
        'note',
        'stageMaskEventJoint',
        'stagePivotEventJoint',
        'stageStyleEventJoint',
        'stageTransformEventJoint',
    ],
} as const satisfies Record<OwnerKey, Entity['type'][]>

type OwnedEntity<K extends OwnerKey> = Extract<Entity, { type: (typeof ownedTypes)[K][number] }>

/** Every editable object that the given key assigns to an owner, once each. */
const walkOwned = <K extends OwnerKey>(
    source: Store,
    key: K,
    callback: (entity: OwnedEntity<K>) => void,
) => {
    for (const notes of source.slides.note.values()) {
        for (const note of notes) callback(note as OwnedEntity<K>)
    }
    for (const type of ownedTypes[key]) {
        if (type === 'note') continue
        // Grid cells repeat entities that span several cells.
        const seen = new Set<Entity>()
        for (const entities of source.grid[type].values()) {
            for (const entity of entities) {
                if (seen.has(entity)) continue
                seen.add(entity)
                callback(entity as OwnedEntity<K>)
            }
        }
    }
}

const ownerOf = (entity: Entity, key: OwnerKey): number | undefined =>
    key in entity ? (entity as unknown as Record<OwnerKey, number>)[key] : undefined

/** One owner, or several, as for a folder's members. */
export type Owners = number | ReadonlySet<number>

const isOwnedBy = (owner: number | undefined, owners: Owners) =>
    owner !== undefined && (typeof owners === 'number' ? owner === owners : owners.has(owner))

const countOwned = (source: Store, key: OwnerKey) => {
    const counts = new Map<number, number>()
    walkOwned(source, key, (entity) => {
        const owner = ownerOf(entity, key)
        if (owner !== undefined) counts.set(owner, (counts.get(owner) ?? 0) + 1)
    })
    return counts
}

// Counts follow the store, which keeps its identity across selection-only
// state changes, so selecting never recounts.
const groupCounts = computed(() => countOwned(store.value, 'groupId'))
const stageCounts = computed(() => countOwned(store.value, 'stageId'))

/** Number of notes and events (time scales or stage events) per owner. */
export const ownedCounts = (key: OwnerKey): ReadonlyMap<number, number> =>
    key === 'groupId' ? groupCounts.value : stageCounts.value

/** The owner's objects that are currently visible in the editor. */
const visibleOwned = (key: OwnerKey, owners: Owners) => {
    const scope = scopeLookup.value
    const entities: Entity[] = []
    walkOwned(store.value, key, (entity) => {
        if (!isOwnedBy(ownerOf(entity, key), owners)) return
        if (entityScopeVisibility(entity, scope) === 'hidden') return
        entities.push(entity)
    })
    return entities
}

/** Whether Select Objects would select anything. */
export const hasVisibleOwned = (key: OwnerKey, owners: Owners) =>
    visibleOwned(key, owners).length > 0

/**
 * Selects the owner's objects that are currently visible in the editor. The
 * selection is not an edit, so it replaces the state without history. With
 * none visible, the selection stays.
 */
export const selectOwned = (key: OwnerKey, owners: Owners) => {
    const entities = visibleOwned(key, owners)
    if (!entities.length) return 0
    replaceState({
        ...state.value,
        selectedEntities: entities,
    })
    notify(interpolate(() => i18n.value.workspace.manager.selected, `${entities.length}`))
    return entities.length
}

/** Whether the selection holds objects that could move to this owner. */
export const canMoveSelectionTo = (key: OwnerKey, owner: number) =>
    selectedEntities.value.some(
        (entity) =>
            (ownedTypes[key] as readonly string[]).includes(entity.type) &&
            ownerOf(entity, key) !== owner,
    )

/** Reassigns the selected objects to this owner as one property edit. */
export const moveSelectionTo = async (key: OwnerKey, owner: number) => {
    if (!canMoveSelectionTo(key, owner)) return
    // Loaded on use: the property-edit path pulls in every tool, which in turn
    // reaches the commands that open these managers.
    const { editSelectedEditableEntities } = await import('../../sidebars/default')
    editSelectedEditableEntities({ [key]: owner })
}

/**
 * The selection left after deleting an owner: everything except its objects
 * (and derived connections, which the deletion rebuilds).
 */
export const survivingSelection = (key: OwnerKey, owners: Owners): Entity[] =>
    selectedEntities.value.filter((entity) => {
        if (entity.type === 'connector') return false
        if (isOwnedBy(ownerOf(entity, key), owners)) return false
        return !(
            key === 'stageId' &&
            'min' in entity &&
            isOwnedBy(ownerOf(entity.min, key), owners)
        )
    })
