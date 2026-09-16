import { type Tool } from '.'
import type { BpmObject } from '../../chart/bpm'
import type { CameraEventObject } from '../../chart/events/camera'
import type { StageMaskEventObject } from '../../chart/events/stage/mask'
import type { StagePivotEventObject } from '../../chart/events/stage/pivot'
import type { StageStyleEventObject } from '../../chart/events/stage/style'
import type { StageTransformEventObject } from '../../chart/events/stage/transform'
import type { NoteObject } from '../../chart/note'
import type { TimeScaleObject } from '../../chart/timeScale'
import { pushState, replaceState, state } from '../../history'
import { selectedEntities } from '../../history/selectedEntities'
import { i18n } from '../../i18n'
import { clearPreviewEdit, setPreviewEdit } from '../../preview/edit'
import type { State } from '../../state'
import type { Entity, EntityType } from '../../state/entities'
import { toBpmEntity, type BpmEntity } from '../../state/entities/bpm'
import {
    toCameraEventJointEntity,
    type CameraEventJointEntity,
} from '../../state/entities/events/joints/camera'
import {
    toStageMaskEventJointEntity,
    type StageMaskEventJointEntity,
} from '../../state/entities/events/joints/stage/mask'
import {
    toStagePivotEventJointEntity,
    type StagePivotEventJointEntity,
} from '../../state/entities/events/joints/stage/pivot'
import {
    toStageStyleEventJointEntity,
    type StageStyleEventJointEntity,
} from '../../state/entities/events/joints/stage/style'
import {
    toStageTransformEventJointEntity,
    type StageTransformEventJointEntity,
} from '../../state/entities/events/joints/stage/transform'
import { toNoteEntity, type NoteEntity } from '../../state/entities/slides/note'
import { toTimeScaleEntity, type TimeScaleEntity } from '../../state/entities/timeScale'
import { addBpm, removeBpm } from '../../state/mutations/bpm'
import { addCameraEventJoint, removeCameraEventJoint } from '../../state/mutations/events/camera'
import {
    addStageMaskEventJoint,
    removeStageMaskEventJoint,
} from '../../state/mutations/events/stage/mask'
import {
    addStagePivotEventJoint,
    removeStagePivotEventJoint,
} from '../../state/mutations/events/stage/pivot'
import {
    addStageStyleEventJoint,
    removeStageStyleEventJoint,
} from '../../state/mutations/events/stage/style'
import {
    addStageTransformEventJoint,
    removeStageTransformEventJoint,
} from '../../state/mutations/events/stage/transform'
import { replaceNote } from '../../state/mutations/slides/note'
import { addTimeScale, removeTimeScale } from '../../state/mutations/timeScale'
import { getInStoreGrid } from '../../state/store/grid'
import {
    createTransaction,
    type Transaction,
    type TransactionOptions,
} from '../../state/transaction'
import { interpolate } from '../../utils/interpolate'
import { notify } from '../notification'
import {
    focusEntityAtBeat,
    focusViewAtBeat,
    setViewHover,
    view,
    xToLane,
    yToBeatOffset,
    yToTime,
    yToValidBeat,
} from '../view'
import { getOnlyEntityType } from './entityType'
import {
    hitAllEntitiesAtPoint,
    hitAllEntitiesInSelection,
    modifyEntities,
    offset,
    resize,
    toSelection,
} from './utils'

type MoveActive = {
    type: 'move'
    lane: number
    focus: Entity
    entities: Entity[]
    onlyType: EntityType | undefined
    lastLane?: number
    lastBeatOffset?: number
}

let active:
    | MoveActive
    | {
          type: 'select'
          lane: number
          time: number
          count: number
          entities: Entity[]
      }
    | undefined

export const select: Tool = {
    title: () => i18n.value.tools.select.title,

    hover(x, y, modifiers) {
        const entities = modifyEntities(hitAllEntitiesAtPoint(x, y), modifiers)

        view.entities = {
            hovered: entities,
            creating: [],
        }
    },

    tap(x, y, modifiers) {
        if (modifiers.ctrl) {
            const entities = modifyEntities(hitAllEntitiesAtPoint(x, y), modifiers)

            const [entity] = entities
            if (!entity) return

            const targets = entities.every((entity) => selectedEntities.value.includes(entity))
                ? selectedEntities.value.filter((entity) => !entities.includes(entity))
                : [...new Set([...selectedEntities.value, ...entities])]

            replaceState({
                ...state.value,
                selectedEntities: targets,
            })
            view.entities = {
                hovered: entities,
                creating: [],
            }
            focusEntityAtBeat(entity.beat)

            notify(interpolate(() => i18n.value.tools.select.selected, `${targets.length}`))
        } else {
            const entities = hitAllEntitiesAtPoint(x, y)

            const selectedLength = selectedEntities.value.length
            const current = selectedLength ? selectedEntities.value[0] : undefined

            const index = current ? (entities.indexOf(current) + 1) % entities.length : 0
            const entity = entities[index]
            const targets = modifyEntities(entity ? [entity] : [], modifiers)

            replaceState({
                ...state.value,
                selectedEntities: targets,
            })
            view.entities = {
                hovered: entities,
                creating: [],
            }

            if (entity) {
                focusEntityAtBeat(entity.beat)

                notify(interpolate(() => i18n.value.tools.select.selected, `${targets.length}`))
            } else {
                focusViewAtBeat(yToValidBeat(y))

                if (selectedLength) notify(() => i18n.value.tools.select.deselected)
            }
        }
    },

    dragStart(x, y) {
        const lane = xToLane(x)
        const time = yToTime(y)

        const entities = hitAllEntitiesAtPoint(x, y)

        const [focus] = entities.filter((entity) => selectedEntities.value.includes(entity))
        if (focus) {
            focusEntityAtBeat(focus.beat)

            notify(
                interpolate(
                    () => i18n.value.tools.select.moving,
                    `${selectedEntities.value.length}`,
                ),
            )

            active = {
                type: 'move',
                lane,
                focus,
                entities: selectedEntities.value,
                onlyType: getOnlyEntityType(selectedEntities.value),
            }
        } else {
            const [entity] = entities
            if (entity) {
                replaceState({
                    ...state.value,
                    selectedEntities: [entity],
                })
                view.entities = {
                    hovered: [],
                    creating: [],
                }
                focusEntityAtBeat(entity.beat)

                notify(interpolate(() => i18n.value.tools.select.moving, '1'))

                active = {
                    type: 'move',
                    lane,
                    focus: entity,
                    entities: [entity],
                    onlyType: entity.type,
                }
            } else {
                active = {
                    type: 'select',
                    lane,
                    time,
                    count: -1,
                    entities: selectedEntities.value,
                }
            }
        }

        return true
    },

    dragUpdate(x, y, modifiers) {
        if (!active) return

        setViewHover(y)

        switch (active.type) {
            case 'move': {
                const lane = xToLane(x)
                const beatOffset = yToBeatOffset(y, active.focus.beat)

                if (active.lastLane === lane && active.lastBeatOffset === beatOffset) break
                active.lastLane = lane
                active.lastBeatOffset = beatOffset

                const creating: Entity[] = []
                let focusBeat = active.focus.beat
                for (const entity of active.entities) {
                    const beat = entity.beat + beatOffset
                    if (beat < 0) continue

                    const result = creates[entity.type]?.(
                        active.onlyType,
                        entity as never,
                        active.lane,
                        lane,
                        beat,
                        active.focus,
                    )
                    if (!result) continue

                    creating.push(result)
                    if (entity === active.focus) focusBeat = result.beat
                }

                // Selection transforms only change geometry. Pointer movement
                // within the same snapped cells should not rebuild the preview.
                const previous = view.entities.creating
                if (
                    creating.length === previous.length &&
                    creating.every((entity, index) => {
                        const other = previous[index]
                        return (
                            entity.type === other?.type &&
                            entity.beat === other.beat &&
                            entity.hitbox?.lane === other.hitbox?.lane &&
                            entity.hitbox?.w === other.hitbox?.w
                        )
                    })
                ) {
                    break
                }

                view.entities = {
                    hovered: [],
                    creating,
                }
                const source = state.value
                const move = active
                setPreviewEdit(source, () =>
                    moveEntities(source, move, lane, beatOffset, { autoAddGroup: false }),
                )
                focusEntityAtBeat(focusBeat)
                break
            }
            case 'select': {
                const selection = toSelection(active.lane, active.time, x, y)
                const entities = modifyEntities(hitAllEntitiesInSelection(selection), modifiers)
                const targets = modifiers.ctrl
                    ? [...new Set([...active.entities, ...entities])]
                    : entities

                replaceState({
                    ...state.value,
                    selectedEntities: targets,
                })
                view.selection = selection
                view.entities = {
                    hovered: [],
                    creating: [],
                }

                if (active.count === targets.length) return
                active.count = targets.length

                notify(interpolate(() => i18n.value.tools.select.selecting, `${targets.length}`))
                break
            }
        }
    },

    dragEnd(x, y, modifiers) {
        if (!active) return

        switch (active.type) {
            case 'move': {
                const lane = xToLane(x)
                const beatOffset = yToBeatOffset(y, active.focus.beat)
                const moved = moveEntities(state.value, active, lane, beatOffset)
                const selectedEntities = moved.selectedEntities
                const focus = creates[active.focus.type]?.(
                    active.onlyType,
                    active.focus as never,
                    active.lane,
                    lane,
                    active.focus.beat + beatOffset,
                    active.focus,
                )

                pushState(
                    interpolate(() => i18n.value.tools.select.moved, `${selectedEntities.length}`),
                    moved,
                )
                view.entities = {
                    hovered: [],
                    creating: [],
                }
                focusEntityAtBeat(focus?.beat ?? active.focus.beat)

                notify(
                    interpolate(() => i18n.value.tools.select.moved, `${selectedEntities.length}`),
                )
                break
            }
            case 'select': {
                const selection = toSelection(active.lane, active.time, x, y)
                const entities = modifyEntities(hitAllEntitiesInSelection(selection), modifiers)
                const targets = modifiers.ctrl
                    ? [...new Set([...active.entities, ...entities])]
                    : entities

                replaceState({
                    ...state.value,
                    selectedEntities: targets,
                })
                view.selection = undefined
                view.entities = {
                    hovered: [],
                    creating: [],
                }

                notify(interpolate(() => i18n.value.tools.select.selected, `${targets.length}`))
                break
            }
        }

        active = undefined
        clearPreviewEdit()
    },

    dragCancel() {
        active = undefined
        clearPreviewEdit()
    },
}

const moveEntities = (
    source: State,
    active: MoveActive,
    lane: number,
    beatOffset: number,
    options?: TransactionOptions,
) => {
    const transaction = createTransaction(source, options)
    const entities = [...active.entities].sort(
        beatOffset > 0 ? (a, b) => b.beat - a.beat : (a, b) => a.beat - b.beat,
    )
    const selectedEntities: Entity[] = []
    for (const entity of entities) {
        const beat = entity.beat + beatOffset
        if (beat < 0) continue

        const result = moves[entity.type]?.(
            transaction,
            active.onlyType,
            entity as never,
            active.lane,
            lane,
            beat,
            active.focus,
        )
        if (result) selectedEntities.push(...result)
    }
    return transaction.commit(selectedEntities)
}

const toMovedBpmObject = (entity: BpmEntity, beat: number): BpmObject => ({
    ...entity,
    beat,
})

const toMovedTimeScaleObject = (
    onlyType: EntityType | undefined,
    entity: TimeScaleEntity,
    startLane: number,
    lane: number,
    beat: number,
): TimeScaleObject => ({
    ...entity,
    beat,
    editorLane:
        onlyType === 'timeScale' ? entity.editorLane + offset(startLane, lane) : entity.editorLane,
})

const toMovedCameraEventObject = (
    onlyType: EntityType | undefined,
    entity: CameraEventJointEntity,
    startLane: number,
    lane: number,
    beat: number,
    focus: Entity,
): CameraEventObject => {
    if (
        focus.type === 'cameraEventJoint' &&
        onlyType === 'cameraEventJoint' &&
        (startLane <= focus.cameraLeft + 0.5 ||
            startLane >= focus.cameraLeft + focus.cameraSize - 0.5)
    ) {
        const [cameraLeft, cameraSize] = resize(
            entity.cameraLeft +
                (startLane >= focus.cameraLeft + focus.cameraSize / 2 ? 0 : entity.cameraSize),
            lane,
            6,
            24,
        )

        return {
            ...entity,
            cameraLeft,
            cameraSize,
        }
    }

    return {
        ...entity,
        beat,
        cameraLeft: entity.cameraLeft + offset(startLane, lane),
    }
}

const toMovedStageMaskEventObject = (
    onlyType: EntityType | undefined,
    entity: StageMaskEventJointEntity,
    startLane: number,
    lane: number,
    beat: number,
    focus: Entity,
): StageMaskEventObject => {
    if (
        focus.type === 'stageMaskEventJoint' &&
        onlyType === 'stageMaskEventJoint' &&
        (startLane <= focus.maskLeft + 0.5 || startLane >= focus.maskLeft + focus.maskSize - 0.5)
    ) {
        const [maskLeft, maskSize] = resize(
            entity.maskLeft +
                (startLane >= focus.maskLeft + focus.maskSize / 2 ? 0 : entity.maskSize),
            lane,
        )

        return {
            ...entity,
            maskLeft,
            maskSize,
        }
    }

    return {
        ...entity,
        beat,
        maskLeft: entity.maskLeft + offset(startLane, lane),
    }
}

const toMovedStagePivotEventObject = (
    entity: StagePivotEventJointEntity,
    startLane: number,
    lane: number,
    beat: number,
): StagePivotEventObject => ({
    ...entity,
    beat,
    pivotLane: entity.pivotLane + offset(startLane, lane),
})

const toMovedStageStyleEventObject = (
    onlyType: EntityType | undefined,
    entity: StageStyleEventJointEntity,
    startLane: number,
    lane: number,
    beat: number,
): StageStyleEventObject => ({
    ...entity,
    beat,
    editorLane:
        onlyType === 'stageStyleEventJoint'
            ? entity.editorLane + offset(startLane, lane)
            : entity.editorLane,
})

const toMovedStageTransformEventObject = (
    entity: StageTransformEventJointEntity,
    startLane: number,
    lane: number,
    beat: number,
): StageTransformEventObject => ({
    ...entity,
    beat,
    xTranslation: entity.xTranslation + offset(startLane, lane),
})

const toMovedNoteObject = (
    onlyType: EntityType | undefined,
    entity: NoteEntity,
    startLane: number,
    lane: number,
    beat: number,
    focus: Entity,
): NoteObject => {
    if (
        focus.type === 'note' &&
        onlyType === 'note' &&
        (startLane <= focus.left + 0.5 || startLane >= focus.left + focus.size - 0.5)
    ) {
        const isLeft = startLane >= focus.left + focus.size / 2

        const [left, size] = resize(
            entity.left + (isLeft ? 0 : entity.size),
            entity.left + (isLeft ? entity.size : 0) + (lane - startLane),
            1,
        )

        return {
            ...entity,
            left,
            size,
        }
    }

    return {
        ...entity,
        beat,
        left: entity.left + offset(startLane, lane),
    }
}

type Create<T extends Entity> = (
    onlyType: EntityType | undefined,
    entity: T,
    startLane: number,
    lane: number,
    beat: number,
    focus: Entity,
) => Entity | undefined

const creates: {
    [T in Entity as T['type']]: Create<T> | undefined
} = {
    bpm: (onlyType, entity, startLane, lane, beat) => toBpmEntity(toMovedBpmObject(entity, beat)),
    timeScale: (onlyType, entity, startLane, lane, beat) =>
        toTimeScaleEntity(toMovedTimeScaleObject(onlyType, entity, startLane, lane, beat)),

    cameraEventJoint: (onlyType, entity, startLane, lane, beat, focus) =>
        toCameraEventJointEntity(
            toMovedCameraEventObject(onlyType, entity, startLane, lane, beat, focus),
        ),
    cameraEventConnection: undefined,

    stageMaskEventJoint: (onlyType, entity, startLane, lane, beat, focus) =>
        toStageMaskEventJointEntity(
            toMovedStageMaskEventObject(onlyType, entity, startLane, lane, beat, focus),
        ),
    stageMaskEventConnection: undefined,

    stagePivotEventJoint: (onlyType, entity, startLane, lane, beat) =>
        toStagePivotEventJointEntity(toMovedStagePivotEventObject(entity, startLane, lane, beat)),
    stagePivotEventConnection: undefined,

    stageStyleEventJoint: (onlyType, entity, startLane, lane, beat) =>
        toStageStyleEventJointEntity(
            toMovedStageStyleEventObject(onlyType, entity, startLane, lane, beat),
        ),
    stageStyleEventConnection: undefined,

    stageTransformEventJoint: (onlyType, entity, startLane, lane, beat) =>
        toStageTransformEventJointEntity(
            toMovedStageTransformEventObject(entity, startLane, lane, beat),
        ),
    stageTransformEventConnection: undefined,

    note: (onlyType, entity, startLane, lane, beat, focus) =>
        toNoteEntity(
            entity.slideId,
            toMovedNoteObject(onlyType, entity, startLane, lane, beat, focus),
            entity,
        ),
    connector: undefined,
}

type Move<T extends Entity> = (
    transaction: Transaction,
    onlyType: EntityType | undefined,
    entity: T,
    startLane: number,
    lane: number,
    beat: number,
    focus: Entity,
) => Entity[] | undefined

const moves: {
    [T in Entity as T['type']]: Move<T> | undefined
} = {
    bpm: (transaction, onlyType, entity, startLane, lane, beat) => {
        const object = toMovedBpmObject(entity, beat)

        if (entity.beat) removeBpm(transaction, entity)

        const overlap = getInStoreGrid(transaction.store.grid, 'bpm', object.beat)?.find(
            (entity) => entity.beat === object.beat,
        )
        if (overlap) removeBpm(transaction, overlap)

        return addBpm(transaction, object)
    },
    timeScale: (transaction, onlyType, entity, startLane, lane, beat) => {
        const object = toMovedTimeScaleObject(onlyType, entity, startLane, lane, beat)

        removeTimeScale(transaction, entity)

        const overlap = getInStoreGrid(transaction.store.grid, 'timeScale', object.beat)?.find(
            (entity) => entity.beat === object.beat && entity.groupId === object.groupId,
        )
        if (overlap) removeTimeScale(transaction, overlap)

        return addTimeScale(transaction, object)
    },

    cameraEventJoint: (transaction, onlyType, entity, startLane, lane, beat, focus) => {
        const object = toMovedCameraEventObject(onlyType, entity, startLane, lane, beat, focus)

        removeCameraEventJoint(transaction, entity)
        return addCameraEventJoint(transaction, object)
    },
    cameraEventConnection: undefined,

    stageMaskEventJoint: (transaction, onlyType, entity, startLane, lane, beat, focus) => {
        const object = toMovedStageMaskEventObject(onlyType, entity, startLane, lane, beat, focus)

        removeStageMaskEventJoint(transaction, entity)
        return addStageMaskEventJoint(transaction, object)
    },
    stageMaskEventConnection: undefined,

    stagePivotEventJoint: (transaction, onlyType, entity, startLane, lane, beat) => {
        const object = toMovedStagePivotEventObject(entity, startLane, lane, beat)

        removeStagePivotEventJoint(transaction, entity)
        return addStagePivotEventJoint(transaction, object)
    },
    stagePivotEventConnection: undefined,

    stageStyleEventJoint: (transaction, onlyType, entity, startLane, lane, beat) => {
        const object = toMovedStageStyleEventObject(onlyType, entity, startLane, lane, beat)

        removeStageStyleEventJoint(transaction, entity)
        return addStageStyleEventJoint(transaction, object)
    },
    stageStyleEventConnection: undefined,

    stageTransformEventJoint: (transaction, onlyType, entity, startLane, lane, beat) => {
        const object = toMovedStageTransformEventObject(entity, startLane, lane, beat)

        removeStageTransformEventJoint(transaction, entity)
        return addStageTransformEventJoint(transaction, object)
    },
    stageTransformEventConnection: undefined,

    note: (transaction, onlyType, entity, startLane, lane, beat, focus) => {
        const object = toMovedNoteObject(onlyType, entity, startLane, lane, beat, focus)

        return replaceNote(transaction, entity, object)
    },
    connector: undefined,
}
