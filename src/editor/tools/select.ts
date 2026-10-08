import type { Tool } from '.'
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
import { addBpm, removeBpm, replaceBpm } from '../../state/mutations/bpm'
import {
    addCameraEventJoint,
    removeCameraEventJoint,
    replaceCameraEventJoint,
} from '../../state/mutations/events/camera'
import {
    addStageMaskEventJoint,
    removeStageMaskEventJoint,
    replaceStageMaskEventJoint,
} from '../../state/mutations/events/stage/mask'
import {
    addStagePivotEventJoint,
    removeStagePivotEventJoint,
    replaceStagePivotEventJoint,
} from '../../state/mutations/events/stage/pivot'
import {
    addStageStyleEventJoint,
    removeStageStyleEventJoint,
    replaceStageStyleEventJoint,
} from '../../state/mutations/events/stage/style'
import {
    addStageTransformEventJoint,
    removeStageTransformEventJoint,
    replaceStageTransformEventJoint,
} from '../../state/mutations/events/stage/transform'
import { replaceNote } from '../../state/mutations/slides/note'
import { addTimeScale, removeTimeScale, replaceTimeScale } from '../../state/mutations/timeScale'
import { getInStoreGrid } from '../../state/store/grid'
import {
    createTransaction,
    type Transaction,
    type TransactionOptions,
} from '../../state/transaction'
import { interpolate } from '../../utils/interpolate'
import { shiftComputed } from '../../utils/math'
import { constrainLaneObject, minimumNoteSize } from '../laneLimits'
import { clearNotification, notify } from '../notification'
import { hitOffscreenIndicator, selectOffscreenNotes } from '../offscreenIndicators'
import { isEntityInScope } from '../scope'
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
    getLaneAnchor,
    hitAllEntitiesAtPoint,
    hitAllEntitiesInSelection,
    isSelectResize,
    modifyEntities,
    moveLane,
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

const resolveDrag = (
    x: number,
    y: number,
):
    | (MoveActive & { isSelected: boolean })
    | { type: 'select'; lane: number; indicator?: boolean } => {
    const lane = xToLane(x)
    // Off-screen badges sit over the chart; pressing one box-selects.
    if (hitOffscreenIndicator(x, y)) return { type: 'select', lane, indicator: true }
    const entities = hitAllEntitiesAtPoint(x, y)

    const [focus] = entities.filter((entity) => selectedEntities.value.includes(entity))
    if (focus) {
        // Selected objects in hidden or dimmed groups/stages stay put.
        const moving = selectedEntities.value.filter(isEntityInScope)
        return {
            type: 'move',
            lane,
            focus,
            entities: moving,
            onlyType: getOnlyEntityType(moving),
            isSelected: true,
        }
    }

    const [entity] = entities
    if (!entity) return { type: 'select', lane }

    return {
        type: 'move',
        lane,
        focus: entity,
        entities: [entity],
        onlyType: entity.type,
        isSelected: false,
    }
}

export const select: Tool = {
    title: () => i18n.value.tools.select.title,

    hover(x, y, modifiers) {
        const indicator = hitOffscreenIndicator(x, y)
        const entities = modifyEntities(
            indicator ? indicator.targets : hitAllEntitiesAtPoint(x, y, 0.5),
            modifiers,
        )

        view.entities = {
            hovered: entities,
            creating: [],
        }
    },

    tap(x, y, modifiers) {
        const indicator = hitOffscreenIndicator(x, y)
        if (indicator) {
            selectOffscreenNotes(indicator.targets, modifiers)
            return
        }

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

    cursor(x, y) {
        const target = resolveDrag(x, y)
        if (target.type === 'select') return target.indicator ? 'pointer' : 'default'
        if (isSelectResize(target.onlyType, target.focus, target.lane)) return 'ew-resize'
        return target.onlyType === 'bpm' ? 'ns-resize' : 'move'
    },

    dragStart(x, y) {
        const target = resolveDrag(x, y)
        if (target.type === 'select') {
            active = {
                type: 'select',
                lane: target.lane,
                time: yToTime(y),
                count: -1,
                entities: selectedEntities.value,
            }
        } else if (target.isSelected) {
            focusEntityAtBeat(target.focus.beat)

            notify(interpolate(() => i18n.value.tools.select.moving, `${target.entities.length}`))

            active = target
        } else {
            replaceState({
                ...state.value,
                selectedEntities: [target.focus],
            })
            view.entities = {
                hovered: [],
                creating: [],
            }
            focusEntityAtBeat(target.focus.beat)

            notify(interpolate(() => i18n.value.tools.select.moving, '1'))

            active = target
        }

        return true
    },

    dragUpdate(x, y, modifiers) {
        if (!active) return

        setViewHover(y)

        switch (active.type) {
            case 'move': {
                const lane = xToLane(x)
                const beatOffset = toMoveBeatOffset(active, yToBeatOffset(y, active.focus.beat))

                if (active.lastLane === lane && active.lastBeatOffset === beatOffset) break
                active.lastLane = lane
                active.lastBeatOffset = beatOffset

                const creating: Entity[] = []
                let focusBeat = active.focus.beat
                for (const entity of active.entities) {
                    if (isPinned(entity, beatOffset)) continue
                    const beat = entity.beat + beatOffset

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
                const beatOffset = toMoveBeatOffset(active, yToBeatOffset(y, active.focus.beat))
                // Dropping everything where it started adds no undo step.
                if (isUnmoved(active, lane, beatOffset)) {
                    view.entities = {
                        hovered: [],
                        creating: [],
                    }
                    // Its "Moving" notice no longer holds.
                    clearNotification()
                    break
                }
                const moved = moveEntities(state.value, active, lane, beatOffset)
                const selectedEntities = moved.selectedEntities
                const focus = isPinned(active.focus, beatOffset)
                    ? undefined
                    : creates[active.focus.type]?.(
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
    // Same-beat objects move in their stored order, so they keep it.
    const rank = (entity: Entity) =>
        getInStoreGrid(source.store.grid, entity.type, entity.beat)?.indexOf(entity) ?? 0
    const entities = [...active.entities].sort(
        (a, b) => (beatOffset > 0 ? b.beat - a.beat : a.beat - b.beat) || rank(a) - rank(b),
    )
    const selectedEntities: Entity[] = []
    for (const entity of entities) {
        if (isPinned(entity, beatOffset)) continue
        const beat = entity.beat + beatOffset

        const result = moves[entity.type]?.(
            transaction,
            active.onlyType,
            entity as never,
            active.lane,
            lane,
            beat,
            active.focus,
            selectedEntities,
        )
        if (result) selectedEntities.push(...result)
    }
    return transaction.commit(selectedEntities)
}

/** The starting BPM and time scales. */
const isInitial = (entity: Entity) =>
    (entity.type === 'bpm' || entity.type === 'timeScale') && entity.beat === 0

/** Starting values stay at 0 when the rest moves earlier. */
const isPinned = (entity: Entity, beatOffset: number) => beatOffset < 0 && isInitial(entity)

/** Shifts a move later so its earliest object stops at beat 0, as paste does. */
const toMoveBeatOffset = (active: MoveActive, beatOffset: number) =>
    active.entities.reduce(
        (offset, entity) => (isInitial(entity) ? offset : Math.max(offset, -entity.beat)),
        beatOffset,
    )

const isUnmoved = (active: MoveActive, lane: number, beatOffset: number) =>
    active.entities.every((entity) => {
        if (isPinned(entity, beatOffset)) return true
        const moved = creates[entity.type]?.(
            active.onlyType,
            entity as never,
            active.lane,
            lane,
            entity.beat + beatOffset,
            active.focus,
        )
        return (
            !moved ||
            Object.entries(moved).every(
                ([key, value]) =>
                    typeof value === 'object' || entity[key as keyof Entity] === value,
            )
        )
    })

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
    focus: Entity,
): TimeScaleObject =>
    constrainLaneObject(
        {
            ...entity,
            beat,
            editorLane:
                onlyType === 'timeScale'
                    ? moveLane(entity.editorLane, startLane, lane, getLaneAnchor(focus))
                    : entity.editorLane,
        },
        { enabled: entity === focus && (lane !== startLane || beat !== entity.beat) },
    )

const toMovedCameraEventObject = (
    onlyType: EntityType | undefined,
    entity: CameraEventJointEntity,
    startLane: number,
    lane: number,
    beat: number,
    focus: Entity,
): CameraEventObject => {
    if (focus.type === 'cameraEventJoint' && isSelectResize(onlyType, focus, startLane)) {
        const [cameraLeft, cameraSize] = resize(
            shiftComputed(
                entity.cameraLeft,
                startLane >= focus.cameraLeft + focus.cameraSize / 2 ? 0 : entity.cameraSize,
            ),
            lane,
            6,
            24,
            entity.cameraLeft +
                (startLane >= focus.cameraLeft + focus.cameraSize / 2 ? entity.cameraSize : 0),
        )

        return constrainLaneObject(
            {
                ...entity,
                cameraLeft,
                cameraSize,
            },
            {
                enabled: entity === focus && (lane !== startLane || beat !== entity.beat),
                resizing: true,
            },
        )
    }

    return constrainLaneObject(
        {
            ...entity,
            beat,
            cameraLeft: moveLane(entity.cameraLeft, startLane, lane, getLaneAnchor(focus)),
        },
        { enabled: entity === focus && (lane !== startLane || beat !== entity.beat) },
    )
}

const toMovedStageMaskEventObject = (
    onlyType: EntityType | undefined,
    entity: StageMaskEventJointEntity,
    startLane: number,
    lane: number,
    beat: number,
    focus: Entity,
): StageMaskEventObject => {
    if (focus.type === 'stageMaskEventJoint' && isSelectResize(onlyType, focus, startLane)) {
        const [maskLeft, maskSize] = resize(
            shiftComputed(
                entity.maskLeft,
                startLane >= focus.maskLeft + focus.maskSize / 2 ? 0 : entity.maskSize,
            ),
            lane,
            0,
            Number.POSITIVE_INFINITY,
            entity.maskLeft +
                (startLane >= focus.maskLeft + focus.maskSize / 2 ? entity.maskSize : 0),
        )

        return constrainLaneObject(
            {
                ...entity,
                maskLeft,
                maskSize,
            },
            {
                enabled: entity === focus && (lane !== startLane || beat !== entity.beat),
                resizing: true,
            },
        )
    }

    return constrainLaneObject(
        {
            ...entity,
            beat,
            maskLeft: moveLane(entity.maskLeft, startLane, lane, getLaneAnchor(focus)),
        },
        { enabled: entity === focus && (lane !== startLane || beat !== entity.beat) },
    )
}

const toMovedStagePivotEventObject = (
    entity: StagePivotEventJointEntity,
    startLane: number,
    lane: number,
    beat: number,
    focus: Entity,
): StagePivotEventObject =>
    constrainLaneObject(
        {
            ...entity,
            beat,
            pivotLane: moveLane(entity.pivotLane, startLane, lane, getLaneAnchor(focus)),
        },
        { enabled: entity === focus && (lane !== startLane || beat !== entity.beat) },
    )

const toMovedStageStyleEventObject = (
    onlyType: EntityType | undefined,
    entity: StageStyleEventJointEntity,
    startLane: number,
    lane: number,
    beat: number,
    focus: Entity,
): StageStyleEventObject =>
    constrainLaneObject(
        {
            ...entity,
            beat,
            editorLane:
                onlyType === 'stageStyleEventJoint'
                    ? moveLane(entity.editorLane, startLane, lane, getLaneAnchor(focus))
                    : entity.editorLane,
        },
        { enabled: entity === focus && (lane !== startLane || beat !== entity.beat) },
    )

const toMovedStageTransformEventObject = (
    entity: StageTransformEventJointEntity,
    startLane: number,
    lane: number,
    beat: number,
    focus: Entity,
): StageTransformEventObject =>
    constrainLaneObject(
        {
            ...entity,
            beat,
            xTranslation: moveLane(entity.xTranslation, startLane, lane, getLaneAnchor(focus)),
        },
        { enabled: entity === focus && (lane !== startLane || beat !== entity.beat) },
    )

const toMovedNoteObject = (
    onlyType: EntityType | undefined,
    entity: NoteEntity,
    startLane: number,
    lane: number,
    beat: number,
    focus: Entity,
): NoteObject => {
    if (focus.type === 'note' && isSelectResize(onlyType, focus, startLane)) {
        const isLeft = startLane >= focus.left + focus.size / 2

        const [left, size] = resize(
            shiftComputed(entity.left, isLeft ? 0 : entity.size),
            entity.left + (isLeft ? entity.size : 0) + (lane - startLane),
            minimumNoteSize(entity.noteType),
            Number.POSITIVE_INFINITY,
            entity.left + (isLeft ? entity.size : 0),
        )

        return constrainLaneObject(
            {
                ...entity,
                left,
                size,
            },
            {
                enabled: entity === focus && (lane !== startLane || beat !== entity.beat),
                resizing: true,
            },
        )
    }

    return constrainLaneObject(
        {
            ...entity,
            beat,
            left: moveLane(entity.left, startLane, lane, getLaneAnchor(focus)),
        },
        { enabled: entity === focus && (lane !== startLane || beat !== entity.beat) },
    )
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
    timeScale: (onlyType, entity, startLane, lane, beat, focus) =>
        toTimeScaleEntity(toMovedTimeScaleObject(onlyType, entity, startLane, lane, beat, focus)),

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

    stagePivotEventJoint: (onlyType, entity, startLane, lane, beat, focus) =>
        toStagePivotEventJointEntity(
            toMovedStagePivotEventObject(entity, startLane, lane, beat, focus),
        ),
    stagePivotEventConnection: undefined,

    stageStyleEventJoint: (onlyType, entity, startLane, lane, beat, focus) =>
        toStageStyleEventJointEntity(
            toMovedStageStyleEventObject(onlyType, entity, startLane, lane, beat, focus),
        ),
    stageStyleEventConnection: undefined,

    stageTransformEventJoint: (onlyType, entity, startLane, lane, beat, focus) =>
        toStageTransformEventJointEntity(
            toMovedStageTransformEventObject(entity, startLane, lane, beat, focus),
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
    /** Objects already placed by this move; they never replace each other. */
    batch: readonly Entity[],
) => Entity[] | undefined

const moves: {
    [T in Entity as T['type']]: Move<T> | undefined
} = {
    bpm: (transaction, onlyType, entity, startLane, lane, beat, focus, batch) => {
        const object = toMovedBpmObject(entity, beat)
        // A move along its beat is an edit: it keeps its place and replaces nothing.
        if (object.beat === entity.beat) return replaceBpm(transaction, entity, object)

        if (entity.beat) removeBpm(transaction, entity)

        const overlap = getInStoreGrid(transaction.store.grid, 'bpm', object.beat)?.find(
            (entity) => entity.beat === object.beat && !batch.includes(entity),
        )
        if (overlap) removeBpm(transaction, overlap)

        return addBpm(transaction, object)
    },
    timeScale: (transaction, onlyType, entity, startLane, lane, beat, focus, batch) => {
        const object = toMovedTimeScaleObject(onlyType, entity, startLane, lane, beat, focus)
        if (object.beat === entity.beat && object.groupId === entity.groupId)
            return replaceTimeScale(transaction, entity, object)

        removeTimeScale(transaction, entity)

        // Replaces every one of its group at the beat, a pair too, but not its own batch.
        const overlaps = getInStoreGrid(transaction.store.grid, 'timeScale', object.beat) ?? []
        for (const overlap of overlaps)
            if (
                overlap.beat === object.beat &&
                overlap.groupId === object.groupId &&
                !batch.includes(overlap)
            )
                removeTimeScale(transaction, overlap)

        return addTimeScale(transaction, object)
    },

    cameraEventJoint: (transaction, onlyType, entity, startLane, lane, beat, focus) => {
        const object = toMovedCameraEventObject(onlyType, entity, startLane, lane, beat, focus)
        if (object.beat === entity.beat) return replaceCameraEventJoint(transaction, entity, object)

        removeCameraEventJoint(transaction, entity)
        return addCameraEventJoint(transaction, object)
    },
    cameraEventConnection: undefined,

    stageMaskEventJoint: (transaction, onlyType, entity, startLane, lane, beat, focus) => {
        const object = toMovedStageMaskEventObject(onlyType, entity, startLane, lane, beat, focus)
        if (object.beat === entity.beat && object.stageId === entity.stageId)
            return replaceStageMaskEventJoint(transaction, entity, object)

        removeStageMaskEventJoint(transaction, entity)
        return addStageMaskEventJoint(transaction, object)
    },
    stageMaskEventConnection: undefined,

    stagePivotEventJoint: (transaction, onlyType, entity, startLane, lane, beat, focus) => {
        const object = toMovedStagePivotEventObject(entity, startLane, lane, beat, focus)
        if (object.beat === entity.beat && object.stageId === entity.stageId)
            return replaceStagePivotEventJoint(transaction, entity, object)

        removeStagePivotEventJoint(transaction, entity)
        return addStagePivotEventJoint(transaction, object)
    },
    stagePivotEventConnection: undefined,

    stageStyleEventJoint: (transaction, onlyType, entity, startLane, lane, beat, focus) => {
        const object = toMovedStageStyleEventObject(onlyType, entity, startLane, lane, beat, focus)
        if (object.beat === entity.beat && object.stageId === entity.stageId)
            return replaceStageStyleEventJoint(transaction, entity, object)

        removeStageStyleEventJoint(transaction, entity)
        return addStageStyleEventJoint(transaction, object)
    },
    stageStyleEventConnection: undefined,

    stageTransformEventJoint: (transaction, onlyType, entity, startLane, lane, beat, focus) => {
        const object = toMovedStageTransformEventObject(entity, startLane, lane, beat, focus)
        if (object.beat === entity.beat && object.stageId === entity.stageId)
            return replaceStageTransformEventJoint(transaction, entity, object)

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
