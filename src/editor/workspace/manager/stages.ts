import { addToStages, type StageId, type Stages } from '../../../chart/stages'
import { pushState, state } from '../../../history'
import { stages } from '../../../history/stages'
import { getAllEntities } from '../../../history/store'
import { i18n } from '../../../i18n'
import { showModal } from '../../../modals'
import type { Entity } from '../../../state/entities'
import { removeStageMaskEventJoint } from '../../../state/mutations/events/stage/mask'
import { removeStagePivotEventJoint } from '../../../state/mutations/events/stage/pivot'
import { removeStageStyleEventJoint } from '../../../state/mutations/events/stage/style'
import { removeStageTransformEventJoint } from '../../../state/mutations/events/stage/transform.ts'
import { removeNote } from '../../../state/mutations/slides/note'
import { createTransaction } from '../../../state/transaction'
import { interpolate } from '../../../utils/interpolate'
import StagePropertiesModal from '../../commands/manageStages/manageStages/stageProperties/StagePropertiesModal.vue'
import { notify } from '../../notification'
import { stageScope } from '../../scope'
import { view } from '../../view'
import { normalizeName, reorderEntries, swapEntries, type ManagerModel } from './model'
import { survivingSelection } from './objects'

const nameOf = (stageId: StageId) => stages.value.get(stageId)?.name ?? ''

export const addStage = () => {
    const newStages: Stages = new Map(stages.value)
    const [stageId, name] = addToStages(newStages)

    pushState(
        interpolate(() => i18n.value.commands.manageStages.modal.added, name),
        {
            ...state.value,
            stages: newStages,
        },
    )

    notify(interpolate(() => i18n.value.commands.manageStages.modal.added, name))

    return stageId
}

export const moveStage = (stageId: StageId, offset: -1 | 1) => {
    const newStages = swapEntries(stages.value, stageId, offset)
    if (!newStages) return

    const name = nameOf(stageId)
    pushState(
        interpolate(() => i18n.value.commands.manageStages.modal.moved, name),
        {
            ...state.value,
            stages: newStages,
        },
    )

    notify(interpolate(() => i18n.value.commands.manageStages.modal.moved, name))
}

export const moveStageTo = (stageId: StageId, index: number) => {
    const newStages = reorderEntries(stages.value, stageId, index)
    if (!newStages) return

    const name = nameOf(stageId)
    pushState(
        interpolate(() => i18n.value.commands.manageStages.modal.moved, name),
        {
            ...state.value,
            stages: newStages,
        },
    )

    notify(interpolate(() => i18n.value.commands.manageStages.modal.moved, name))
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

/** Deletes a stage with its events and notes, keeping at least one stage. */
export const deleteStage = (stageId: StageId) => {
    if (!stages.value.has(stageId)) return
    const name = nameOf(stageId)

    const transaction = createTransaction(state.value)

    const removes: {
        [T in Entity as T['type']]: ((entity: T) => void) | undefined
    } = {
        bpm: undefined,
        timeScale: undefined,

        cameraEventJoint: undefined,
        cameraEventConnection: undefined,

        stageMaskEventJoint(entity) {
            if (entity.stageId !== stageId) return

            removeStageMaskEventJoint(transaction, entity)
        },
        stageMaskEventConnection: undefined,

        stagePivotEventJoint(entity) {
            if (entity.stageId !== stageId) return

            removeStagePivotEventJoint(transaction, entity)
        },
        stagePivotEventConnection: undefined,

        stageStyleEventJoint(entity) {
            if (entity.stageId !== stageId) return

            removeStageStyleEventJoint(transaction, entity)
        },
        stageStyleEventConnection: undefined,

        stageTransformEventJoint(entity) {
            if (entity.stageId !== stageId) return

            removeStageTransformEventJoint(transaction, entity)
        },
        stageTransformEventConnection: undefined,

        note(entity) {
            if (entity.stageId !== stageId) return

            removeNote(transaction, entity)
        },
        connector: undefined,
    }

    for (const entity of getAllEntities()) {
        removes[entity.type]?.(entity as never)
    }

    // Keep the rest of the selection; only the deleted objects leave it.
    const newState = transaction.commit(survivingSelection('stageId', stageId))
    newState.stages = new Map(newState.stages)
    newState.stages.delete(stageId)
    if (!newState.stages.size) addToStages(newState.stages)

    pushState(
        interpolate(() => i18n.value.commands.manageStages.modal.deleted, name),
        newState,
    )
    view.entities = {
        hovered: [],
        creating: [],
    }

    notify(interpolate(() => i18n.value.commands.manageStages.modal.deleted, name))
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
    }),
    add: addStage,
    move: moveStage,
    moveTo: moveStageTo,
    rename: renameStage,
    remove: deleteStage,
    openProperties: openStageProperties,
    owner: 'stageId',
}
