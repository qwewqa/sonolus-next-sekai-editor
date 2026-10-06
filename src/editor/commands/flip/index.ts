import type { Command } from '..'
import type { FlickDirection } from '../../../chart/note'
import { pushState, state } from '../../../history'
import { selectedEntities } from '../../../history/selectedEntities'
import { i18n } from '../../../i18n'
import type { Entity } from '../../../state/entities'
import type { EditableEntity, EditableObject } from '../../../state/operations/editable'
import { editChanges, editEntity } from '../../../state/operations/properties/plan'
import { createTransaction } from '../../../state/transaction'
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

        const changes = new Map<Entity, EditableObject>()
        for (const entity of entities) {
            const object = flips[entity.type]?.(entities, entity as never)
            if (object && editChanges(state.value.store, entity, object))
                changes.set(entity, object)
        }
        // Nothing to flip, as with BPM changes alone: no history entry.
        if (!changes.size) {
            notify(() => i18n.value.sidebars.default.noChange)
            return
        }

        const transaction = createTransaction(state.value)

        const flippedEntities = entities.flatMap((entity) => {
            const object = changes.get(entity)
            return object ? editEntity(transaction, entity as EditableEntity, object) : [entity]
        })

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

type Flip<T> = (entities: Entity[], entity: T) => EditableObject

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
    timeScale: (entities, entity) => ({
        editorLane: entities.every((entity) => entity.type === 'timeScale')
            ? -entity.editorLane
            : entity.editorLane,
    }),

    cameraEventJoint: (entities, entity) => ({
        cameraLeft: -(entity.cameraLeft + entity.cameraSize),
        cameraZoomTargetLane: -entity.cameraZoomTargetLane,
        cameraRotation: -entity.cameraRotation,
    }),
    cameraEventConnection: undefined,

    stageMaskEventJoint: (entities, entity) => ({
        maskLeft: -(entity.maskLeft + entity.maskSize),
    }),
    stageMaskEventConnection: undefined,

    stagePivotEventJoint: (entities, entity) => ({
        pivotLane: -entity.pivotLane,
    }),
    stagePivotEventConnection: undefined,

    stageStyleEventJoint: (entities, entity) => ({
        editorLane: entities.every((entity) => entity.type === 'stageStyleEventJoint')
            ? -entity.editorLane
            : entity.editorLane,
        leftBorderStyle: entity.rightBorderStyle,
        rightBorderStyle: entity.leftBorderStyle,
    }),
    stageStyleEventConnection: undefined,

    stageTransformEventJoint: (entities, entity) => ({
        rotation: -entity.rotation,
        xTranslation: -entity.xTranslation,
    }),
    stageTransformEventConnection: undefined,

    note: (entities, entity) => ({
        left: -(entity.left + entity.size),
        flickDirection: flippedFlickDirections[entity.flickDirection],
    }),
    connector: undefined,
}
