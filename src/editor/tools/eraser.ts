import type { Tool } from '.'
import { pushState, replaceState, state } from '../../history'
import { selectedEntities } from '../../history/selectedEntities'
import { i18n } from '../../i18n'
import type { Entity } from '../../state/entities'
import type { RemoveMutation } from '../../state/mutations'
import { removeBpm } from '../../state/mutations/bpm'
import { removeCameraEventJoint } from '../../state/mutations/events/camera'
import { removeStageMaskEventJoint } from '../../state/mutations/events/stage/mask'
import { removeStagePivotEventJoint } from '../../state/mutations/events/stage/pivot'
import { removeStageStyleEventJoint } from '../../state/mutations/events/stage/style'
import { removeStageTransformEventJoint } from '../../state/mutations/events/stage/transform'
import { removeNote } from '../../state/mutations/slides/note'
import { removeTimeScale } from '../../state/mutations/timeScale'
import { createTransaction } from '../../state/transaction'
import { interpolate } from '../../utils/interpolate'
import { clearNotification, notify } from '../notification'
import {
    focusEntityAtBeat,
    focusViewAtBeat,
    setViewHover,
    view,
    xToLane,
    yToTime,
    yToValidBeat,
} from '../view'
import { hitAllEntitiesAtPoint, hitAllEntitiesInSelection, toSelection } from './utils'

let active:
    | {
          lane: number
          time: number
          count: number
      }
    | undefined

const tapTarget = (x: number, y: number) => {
    const entities = hitAllEntitiesAtPoint(x, y)
    if (entities.some((entity) => selectedEntities.value.includes(entity))) return 'selection'

    return entities.find(canRemove)
}

export const eraser: Tool = {
    title: () => i18n.value.tools.eraser.title,

    hover(x, y) {
        const entities = hitAllEntitiesAtPoint(x, y, 0.5)

        view.entities = {
            hovered: entities.some((entity) => selectedEntities.value.includes(entity))
                ? []
                : entities.filter(canRemove).slice(0, 1),
            creating: [],
        }
    },

    tap(x, y) {
        const target = tapTarget(x, y)

        if (target === 'selection') {
            focusEntityAtBeat(yToValidBeat(y))
            remove(selectedEntities.value)
        } else if (target) {
            focusEntityAtBeat(target.beat)
            remove([target])
        } else {
            const selectedLength = selectedEntities.value.length

            replaceState({
                ...state.value,
                selectedEntities: [],
            })
            view.entities = {
                hovered: [],
                creating: [],
            }

            focusViewAtBeat(yToValidBeat(y))
            if (selectedLength) notify(() => i18n.value.tools.eraser.deselected)
        }
    },

    cursor: (x, y) => (tapTarget(x, y) ? 'pointer' : 'crosshair'),

    dragStart(x, y) {
        active = {
            lane: xToLane(x),
            time: yToTime(y),
            count: -1,
        }

        return true
    },

    dragUpdate(x, y) {
        if (!active) return

        setViewHover(y)

        const selection = toSelection(active.lane, active.time, x, y)
        const selectedEntities = hitAllEntitiesInSelection(selection).filter(canRemove)

        replaceState({
            ...state.value,
            selectedEntities,
        })
        view.selection = selection
        view.entities = {
            hovered: [],
            creating: [],
        }

        if (active.count === selectedEntities.length) return
        active.count = selectedEntities.length

        notify(interpolate(() => i18n.value.tools.eraser.erasing, `${selectedEntities.length}`))
    },

    dragEnd(x, y) {
        if (!active) return

        const selection = toSelection(active.lane, active.time, x, y)

        view.selection = undefined

        remove(hitAllEntitiesInSelection(selection))

        active = undefined
    },

    dragCancel() {
        active = undefined
    },
}

const canRemoves: {
    [T in Entity as T['type']]: ((entity: T) => boolean) | undefined
} = {
    bpm: (entity) => entity.beat > 0,
    timeScale: undefined,

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

    note: undefined,
    connector: undefined,
}

const removes: {
    [T in Entity as T['type']]: RemoveMutation<T> | undefined
} = {
    bpm: removeBpm,
    timeScale: removeTimeScale,

    cameraEventJoint: removeCameraEventJoint,
    cameraEventConnection: undefined,

    stageMaskEventJoint: removeStageMaskEventJoint,
    stageMaskEventConnection: undefined,

    stagePivotEventJoint: removeStagePivotEventJoint,
    stagePivotEventConnection: undefined,

    stageTransformEventJoint: removeStageTransformEventJoint,
    stageTransformEventConnection: undefined,

    stageStyleEventJoint: removeStageStyleEventJoint,
    stageStyleEventConnection: undefined,

    note: removeNote,
    connector: undefined,
}

export const canRemove = (entity: Entity) => canRemoves[entity.type]?.(entity as never) ?? true

export const remove = (
    entities: Entity[],
    message: () => string = () => i18n.value.tools.eraser.erased,
) => {
    entities = entities.filter(canRemove)
    if (!entities.length) {
        replaceState({
            ...state.value,
            selectedEntities: [],
        })
        view.entities = {
            hovered: [],
            creating: [],
        }
        // An empty box's progress notice no longer holds.
        clearNotification()
        return
    }

    const transaction = createTransaction(state.value)

    for (const entity of entities) {
        removes[entity.type]?.(transaction, entity as never)
    }

    pushState(interpolate(message, `${entities.length}`), transaction.commit([]))
    view.entities = {
        hovered: [],
        creating: [],
    }

    notify(interpolate(message, `${entities.length}`))
}
