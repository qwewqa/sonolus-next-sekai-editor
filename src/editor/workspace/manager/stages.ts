import type { FolderId } from '../../../chart/folders'
import {
    addDefaultStageToStages,
    addToStages,
    type StageId,
    type Stages,
} from '../../../chart/stages'
import { pushState, state } from '../../../history'
import { stageFolders, stages } from '../../../history/stages'
import { getAllEntities } from '../../../history/store'
import { i18n } from '../../../i18n'
import { showModal } from '../../../modals'
import type { Entity } from '../../../state/entities'
import { removeStageMaskEventJoint } from '../../../state/mutations/events/stage/mask'
import { removeStagePivotEventJoint } from '../../../state/mutations/events/stage/pivot'
import { removeStageStyleEventJoint } from '../../../state/mutations/events/stage/style'
import { removeStageTransformEventJoint } from '../../../state/mutations/events/stage/transform.ts'
import { removeNote } from '../../../state/mutations/slides/note'
import { duplicateOwned } from '../../../state/operations/duplicateOwned'
import { createTransaction } from '../../../state/transaction'
import { interpolate } from '../../../utils/interpolate'
import StagePropertiesModal from '../../commands/manageStages/manageStages/stageProperties/StagePropertiesModal.vue'
import { notify } from '../../notification'
import { stageScope } from '../../scope'
import { view } from '../../view'
import { createFolderOps } from './folders'
import { normalizeName, type ManagerModel } from './model'
import { survivingSelection } from './objects'

const nameOf = (stageId: StageId) => stages.value.get(stageId)?.name ?? ''

/** Adds a stage at the end, or at the end of a folder, in one step. */
export const addStage = (folder?: FolderId) => {
    const newStages: Stages = new Map(stages.value)
    const [stageId, name] = addToStages(newStages)

    const added = { ...state.value, stages: newStages }
    pushState(
        interpolate(() => i18n.value.commands.manageStages.modal.added, name),
        folder === undefined ? added : stageFolderOps.placedIn(added, stageId, folder),
    )

    notify(interpolate(() => i18n.value.commands.manageStages.modal.added, name))

    return stageId
}

export const renameStage = (stageId: StageId, value: string) => {
    const object = stages.value.get(stageId)
    const name = normalizeName(value)
    if (!object || !name || name === object.name) return

    const newStages: Stages = new Map(stages.value)
    newStages.set(stageId, { ...object, name })

    const message = interpolate(() => i18n.value.workspace.stages.renamed, object.name, name)
    pushState(message, {
        ...state.value,
        stages: newStages,
    })

    notify(message)
}

export const openStageProperties = (stageId: StageId) => {
    void showModal(StagePropertiesModal, {
        stageId,
    })
}

/** The state without these stages and their events and notes, keeping at least one stage. */
const removeStages = (stageIds: ReadonlySet<StageId>) => {
    const transaction = createTransaction(state.value)

    const removes: {
        [T in Entity as T['type']]: ((entity: T) => void) | undefined
    } = {
        bpm: undefined,
        timeScale: undefined,

        cameraEventJoint: undefined,
        cameraEventConnection: undefined,

        stageMaskEventJoint(entity) {
            if (!stageIds.has(entity.stageId)) return

            removeStageMaskEventJoint(transaction, entity)
        },
        stageMaskEventConnection: undefined,

        stagePivotEventJoint(entity) {
            if (!stageIds.has(entity.stageId)) return

            removeStagePivotEventJoint(transaction, entity)
        },
        stagePivotEventConnection: undefined,

        stageStyleEventJoint(entity) {
            if (!stageIds.has(entity.stageId)) return

            removeStageStyleEventJoint(transaction, entity)
        },
        stageStyleEventConnection: undefined,

        stageTransformEventJoint(entity) {
            if (!stageIds.has(entity.stageId)) return

            removeStageTransformEventJoint(transaction, entity)
        },
        stageTransformEventConnection: undefined,

        note(entity) {
            if (!stageIds.has(entity.stageId)) return

            removeNote(transaction, entity)
        },
        connector: undefined,
    }

    for (const entity of getAllEntities()) {
        removes[entity.type]?.(entity as never)
    }

    // Keep the rest of the selection; only the deleted objects leave it.
    const newState = transaction.commit(survivingSelection('stageId', stageIds))

    newState.stages = new Map(newState.stages)
    for (const stageId of stageIds) newState.stages.delete(stageId)
    if (!newState.stages.size) addDefaultStageToStages(newState.stages)

    return newState
}

export const stageFolderOps = createFolderOps({
    entries: () => stages.value,
    folders: () => stageFolders.value,
    withData: (state, stages, stageFolders) => ({ ...state, stages, stageFolders }),
    removeEntries: removeStages,
    entriesOf: (state) => state.stages,
    addEntry: (entries, name, entry) => {
        const { name: _, ...value } = entry
        return addToStages(entries, name, value)[0]
    },
    duplicateObjects: (state, copies) => duplicateOwned(state, { key: 'stageId', copies }),
    owner: 'stageId',
    strings: () => ({
        movedEntry: i18n.value.commands.manageStages.modal.moved,
        deleteFolderTitle: i18n.value.workspace.stages.deleteFolderTitle,
        deleteFolderMessage: i18n.value.workspace.stages.deleteFolderMessage,
        movedSelectedInto: i18n.value.workspace.stages.movedSelectedInto,
        movedSelectedOut: i18n.value.workspace.stages.movedSelectedOut,
        duplicated: i18n.value.workspace.stages.duplicated,
        duplicatedSelected: i18n.value.workspace.stages.duplicatedSelected,
        duplicatedSelectedFolders: i18n.value.workspace.stages.duplicatedSelectedFolders,
        deletedSelected: i18n.value.workspace.stages.deletedSelected,
        deletedSelectedFolders: i18n.value.workspace.stages.deletedSelectedFolders,
    }),
})

/** Deletes a stage with its events and notes, keeping at least one stage. */
export const deleteStage = (stageId: StageId) => {
    if (!stages.value.has(stageId)) return
    const name = nameOf(stageId)

    const ids = new Set([stageId])
    stageFolderOps.commitRemoval(
        ids,
        removeStages(ids),
        interpolate(() => i18n.value.commands.manageStages.modal.deleted, name),
    )
    view.entities = {
        hovered: [],
        creating: [],
    }
}

/** Deletes stages with their objects, and folders, as one step, keeping at least one stage. */
const deleteStages = (stageIds: ReadonlySet<StageId>, folderIds?: ReadonlySet<FolderId>) => {
    stageFolderOps.removeMany(stageIds, folderIds)
    view.entities = {
        hovered: [],
        creating: [],
    }
}

export const stageManager: ManagerModel<StageId> = {
    entries: () => [...stages.value].map(([id, { name }]) => ({ id, name })),
    focused: () => view.stageId,
    scope: stageScope,
    strings: () => ({
        all: i18n.value.workspace.stages.all,
        showAll: i18n.value.workspace.stages.showAll,
        hideAll: i18n.value.workspace.stages.hideAll,
        add: i18n.value.workspace.stages.add,
        properties: i18n.value.commands.manageStages.modal.properties.title,
        moveUp: i18n.value.commands.manageStages.modal.moveUp,
        moveDown: i18n.value.commands.manageStages.modal.moveDown,
        delete: i18n.value.commands.manageStages.modal.delete,
        deleteFolder: i18n.value.workspace.stages.deleteFolder,
        deleteSelectedTitle: i18n.value.workspace.stages.deleteSelectedTitle,
        deleteSelectedMessage: i18n.value.workspace.stages.deleteSelectedMessage,
        deleteSelectedFoldersMessage: i18n.value.workspace.stages.deleteSelectedFoldersMessage,
    }),
    add: addStage,
    move: (id, offset) => {
        stageFolderOps.stepEntry(id, offset)
    },
    rename: renameStage,
    remove: deleteStage,
    removeMany: deleteStages,
    openProperties: openStageProperties,
    owner: 'stageId',
    folders: stageFolderOps,
}
