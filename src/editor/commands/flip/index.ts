import type { Command } from '..'
import type { FlickDirection } from '../../../chart/note'
import { pushState, state } from '../../../history'
import { selectedEntities } from '../../../history/selectedEntities'
import { i18n } from '../../../i18n'
import type { Entity } from '../../../state/entities'
import { editSelectedCameraEvent } from '../../../state/operations/events/camera'
import { editSelectedStageMaskEvent } from '../../../state/operations/events/stage/mask'
import { editSelectedStagePivotEvent } from '../../../state/operations/events/stage/pivot'
import { editSelectedStageStyleEvent } from '../../../state/operations/events/stage/style'
import { editSelectedStageTransformEvent } from '../../../state/operations/events/stage/transform'
import { editSelectedNote } from '../../../state/operations/note'
import { editSelectedTimeScale } from '../../../state/operations/timeScale'
import { createTransaction, type Transaction } from '../../../state/transaction'
import { interpolate } from '../../../utils/interpolate'
import { notify } from '../../notification'
import { view } from '../../view'
import FlipIcon from './FlipIcon.vue'

export const flip: Command = {
    title: () => i18n.value.commands.flip.title,
    icon: {
        is: FlipIcon,
    },

    execute() {
        const entities = selectedEntities.value

        if (!entities.length) {
            notify(() => i18n.value.commands.flip.noSelected)
            return
        }

        const transaction = createTransaction(state.value)

        const flippedEntities = entities.flatMap(
            (entity) => flips[entity.type]?.(transaction, entities, entity as never) ?? [entity],
        )

        pushState(
            interpolate(() => i18n.value.commands.flip.flipped, `${entities.length}`),
            transaction.commit(flippedEntities),
        )
        view.entities = {
            hovered: [],
            creating: [],
        }

        notify(interpolate(() => i18n.value.commands.flip.flipped, `${entities.length}`))
    },
}

type Flip<T> = (transaction: Transaction, entities: Entity[], entity: T) => Entity[]

const flippedFlickDirections: Record<FlickDirection, FlickDirection> = {
    none: 'none',
    up: 'up',
    upLeft: 'upRight',
    upRight: 'upLeft',
    down: 'down',
    downLeft: 'downRight',
    downRight: 'downLeft',
}

const flips: {
    [T in Entity as T['type']]: Flip<T> | undefined
} = {
    bpm: undefined,
    timeScale: (transaction, entities, entity) =>
        editSelectedTimeScale(transaction, entity, {
            editorLane: entities.every((entity) => entity.type === 'timeScale')
                ? -entity.editorLane
                : entity.editorLane,
        }),

    cameraEventJoint: (transaction, entities, entity) =>
        editSelectedCameraEvent(transaction, entity, {
            cameraLeft: -(entity.cameraLeft + entity.cameraSize),
            cameraZoomTargetLane: -entity.cameraZoomTargetLane,
            cameraRotation: -entity.cameraRotation,
        }),
    cameraEventConnection: undefined,

    stageMaskEventJoint: (transaction, entities, entity) =>
        editSelectedStageMaskEvent(transaction, entity, {
            maskLeft: -(entity.maskLeft + entity.maskSize),
        }),
    stageMaskEventConnection: undefined,

    stagePivotEventJoint: (transaction, entities, entity) =>
        editSelectedStagePivotEvent(transaction, entity, {
            pivotLane: -entity.pivotLane,
        }),
    stagePivotEventConnection: undefined,

    stageStyleEventJoint: (transaction, entities, entity) =>
        editSelectedStageStyleEvent(transaction, entity, {
            editorLane: entities.every((entity) => entity.type === 'stageStyleEventJoint')
                ? -entity.editorLane
                : entity.editorLane,
            leftBorderStyle: entity.rightBorderStyle,
            rightBorderStyle: entity.leftBorderStyle,
        }),
    stageStyleEventConnection: undefined,

    stageTransformEventJoint: (transaction, entities, entity) =>
        editSelectedStageTransformEvent(transaction, entity, {
            rotation: -entity.rotation,
            xTranslation: -entity.xTranslation,
        }),
    stageTransformEventConnection: undefined,

    note: (transaction, entities, entity) =>
        editSelectedNote(transaction, entity, {
            left: -(entity.left + entity.size),
            flickDirection: flippedFlickDirections[entity.flickDirection],
        }),
    connector: undefined,
}
