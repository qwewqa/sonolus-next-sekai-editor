import { addToGroups, type GroupId } from '../../../chart/groups'
import { pushState, state } from '../../../history'
import { groups } from '../../../history/groups'
import { getAllEntities } from '../../../history/store'
import { i18n } from '../../../i18n'
import { showModal } from '../../../modals'
import type { Entity } from '../../../state/entities'
import { removeNote } from '../../../state/mutations/slides/note'
import { removeTimeScale } from '../../../state/mutations/timeScale'
import { createTransaction } from '../../../state/transaction'
import { interpolate } from '../../../utils/interpolate'
import GroupPropertiesModal from '../../commands/manageGroups/manageGroups/groupProperties/GroupPropertiesModal.vue'
import { notify } from '../../notification'
import { groupScope } from '../../scope'
import { view } from '../../view'
import { normalizeName, reorderEntries, swapEntries, type ManagerModel } from './model'
import { survivingSelection } from './objects'

const nameOf = (groupId: GroupId) => groups.value.get(groupId)?.name ?? ''

export const addGroup = () => {
    const newGroups = new Map(groups.value)
    const [groupId, name] = addToGroups(newGroups)

    pushState(
        interpolate(() => i18n.value.commands.manageGroups.modal.added, name),
        {
            ...state.value,
            groups: newGroups,
        },
    )

    notify(interpolate(() => i18n.value.commands.manageGroups.modal.added, name))

    return groupId
}

export const moveGroup = (groupId: GroupId, offset: -1 | 1) => {
    const newGroups = swapEntries(groups.value, groupId, offset)
    if (!newGroups) return

    const name = nameOf(groupId)
    pushState(
        interpolate(() => i18n.value.commands.manageGroups.modal.moved, name),
        {
            ...state.value,
            groups: newGroups,
        },
    )

    notify(interpolate(() => i18n.value.commands.manageGroups.modal.moved, name))
}

export const moveGroupTo = (groupId: GroupId, index: number) => {
    const newGroups = reorderEntries(groups.value, groupId, index)
    if (!newGroups) return

    const name = nameOf(groupId)
    pushState(
        interpolate(() => i18n.value.commands.manageGroups.modal.moved, name),
        {
            ...state.value,
            groups: newGroups,
        },
    )

    notify(interpolate(() => i18n.value.commands.manageGroups.modal.moved, name))
}

export const renameGroup = (groupId: GroupId, value: string) => {
    const object = groups.value.get(groupId)
    const name = normalizeName(value)
    if (!object || !name || name === object.name) return

    const newGroups = new Map(groups.value)
    newGroups.set(groupId, { ...object, name })

    const message = interpolate(() => i18n.value.workspace.groups.renamed, object.name, name)
    pushState(message, {
        ...state.value,
        groups: newGroups,
    })

    notify(message)
}

export const openGroupProperties = (groupId: GroupId) => {
    void showModal(GroupPropertiesModal, {
        groupId,
    })
}

/** Deletes a group with its notes and time scales, keeping at least one group. */
export const deleteGroup = (groupId: GroupId) => {
    if (!groups.value.has(groupId)) return
    const name = nameOf(groupId)

    const transaction = createTransaction(state.value)

    const removes: {
        [T in Entity as T['type']]: ((entity: T) => void) | undefined
    } = {
        bpm: undefined,
        timeScale(entity) {
            if (entity.groupId !== groupId) return

            removeTimeScale(transaction, entity)
        },

        cameraEventJoint: undefined,
        cameraEventConnection: undefined,

        stageMaskEventJoint: undefined,
        stageMaskEventConnection: undefined,

        stagePivotEventJoint: undefined,
        stagePivotEventConnection: undefined,

        stageStyleEventJoint: undefined,
        stageStyleEventConnection: undefined,

        stageTransformEventJoint: undefined,
        stageTransformEventConnection: undefined,

        note(entity) {
            if (entity.groupId !== groupId) return

            removeNote(transaction, entity)
        },
        connector: undefined,
    }

    for (const entity of getAllEntities()) {
        removes[entity.type]?.(entity as never)
    }

    // Keep the rest of the selection; only the deleted objects leave it.
    const newState = transaction.commit(survivingSelection('groupId', groupId))

    newState.groups = new Map(newState.groups)
    newState.groups.delete(groupId)
    if (!newState.groups.size) addToGroups(newState.groups)

    pushState(
        interpolate(() => i18n.value.commands.manageGroups.modal.deleted, name),
        newState,
    )
    view.entities = {
        hovered: [],
        creating: [],
    }

    notify(interpolate(() => i18n.value.commands.manageGroups.modal.deleted, name))
}

export const groupManager: ManagerModel<GroupId> = {
    entries: () => [...groups.value].map(([id, { name }]) => ({ id, name })),
    focused: () => view.groupId,
    scope: groupScope,
    strings: () => ({
        all: i18n.value.workspace.groups.all,
        showAll: i18n.value.workspace.groups.showAll,
        hideAll: i18n.value.workspace.groups.hideAll,
        add: i18n.value.workspace.groups.add,
        properties: i18n.value.commands.manageGroups.modal.properties.title,
        moveUp: i18n.value.commands.manageGroups.modal.moveUp,
        moveDown: i18n.value.commands.manageGroups.modal.moveDown,
        delete: i18n.value.commands.manageGroups.modal.delete,
    }),
    add: addGroup,
    move: moveGroup,
    moveTo: moveGroupTo,
    rename: renameGroup,
    remove: deleteGroup,
    openProperties: openGroupProperties,
    owner: 'groupId',
}
