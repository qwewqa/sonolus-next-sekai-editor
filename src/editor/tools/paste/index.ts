import type { Tool } from '..'
import type { BpmObject } from '../../../chart/bpm'
import type { CameraEventObject } from '../../../chart/events/camera'
import type { StageMaskEventObject } from '../../../chart/events/stage/mask'
import type { StagePivotEventObject } from '../../../chart/events/stage/pivot'
import type { StageStyleEventObject } from '../../../chart/events/stage/style'
import type { StageTransformEventObject } from '../../../chart/events/stage/transform.ts'
import type { GroupId } from '../../../chart/groups'
import type { Chart } from '../../../chart/index.ts'
import type { FlickDirection, NoteObject } from '../../../chart/note'
import type { StageId } from '../../../chart/stages'
import type { TimeScaleObject } from '../../../chart/timeScale'
import type { ClipboardData } from '../../../clipboard/data/schema'
import { clipboardEntry, updateClipboard } from '../../../clipboard/index.ts'
import { pushState, state } from '../../../history'
import { chartSessionId } from '../../../history/chartSession'
import { checkDynamicStages, isDynamicStages } from '../../../history/dynamicStages'
import { defaultGroupId, groups } from '../../../history/groups'
import { defaultStageId, stages } from '../../../history/stages'
import { i18n } from '../../../i18n'
import type { Entity, EntityType } from '../../../state/entities'
import { toBpmEntity, type BpmEntity } from '../../../state/entities/bpm'
import {
    toCameraEventJointEntity,
    type CameraEventJointEntity,
} from '../../../state/entities/events/joints/camera'
import {
    toStageMaskEventJointEntity,
    type StageMaskEventJointEntity,
} from '../../../state/entities/events/joints/stage/mask'
import {
    toStagePivotEventJointEntity,
    type StagePivotEventJointEntity,
} from '../../../state/entities/events/joints/stage/pivot'
import {
    toStageStyleEventJointEntity,
    type StageStyleEventJointEntity,
} from '../../../state/entities/events/joints/stage/style'
import {
    toStageTransformEventJointEntity,
    type StageTransformEventJointEntity,
} from '../../../state/entities/events/joints/stage/transform.ts'
import { createSlideId, type SlideId } from '../../../state/entities/slides'
import { toNoteEntity, type NoteEntity } from '../../../state/entities/slides/note'
import { toTimeScaleEntity, type TimeScaleEntity } from '../../../state/entities/timeScale'
import { calculateBpms, toBpmIntegral, type BpmIntegral } from '../../../state/integrals/bpms'
import { addBpm, removeBpm } from '../../../state/mutations/bpm'
import { addCameraEventJoint } from '../../../state/mutations/events/camera'
import { addStageMaskEventJoint } from '../../../state/mutations/events/stage/mask'
import { addStagePivotEventJoint } from '../../../state/mutations/events/stage/pivot'
import { addStageStyleEventJoint } from '../../../state/mutations/events/stage/style'
import { addStageTransformEventJoint } from '../../../state/mutations/events/stage/transform.ts'
import { addNote } from '../../../state/mutations/slides/note'
import { addTimeScale, removeTimeScale } from '../../../state/mutations/timeScale'
import { createStore } from '../../../state/store/creates'
import { getInStoreGrid } from '../../../state/store/grid'
import type { StoreSlides } from '../../../state/store/slides'
import { createTransaction, type Transaction } from '../../../state/transaction'
import { interpolate } from '../../../utils/interpolate'
import { alignComputed } from '../../../utils/math'
import { bisect } from '../../../utils/ordered'
import type { Modifiers } from '../../controls/gestures/pointer'
import { constrainLaneObject } from '../../laneLimits'
import { notify } from '../../notification'
import { revealAuthoringTarget } from '../../scope'
import { entityScopeIds } from '../../scopeRules'
import { alignLane, view, xToLane, yToBeatOffset } from '../../view'
import { getOnlyEntityType } from '../entityType'
import PasteSidebar from './PasteSidebar.vue'

let active:
    | {
          lane: number
          beat: number
          entities: Entity[]
          onlyType: EntityType | undefined
      }
    | undefined

export const paste: Tool = {
    title: () => i18n.value.tools.paste.title,
    sidebar: PasteSidebar,

    hover(x, y, modifiers) {
        void updateClipboard()

        const data = clipboardEntry.value?.data
        if (!data) return

        const entities = cachedTransform(data)
        if (!entities.length) return

        const onlyType = getOnlyEntityType(entities)
        const lane = xToLane(x)
        const beatOffset = toPasteBeatOffset(landing(entities), yToBeatOffset(y, data.beat))

        showGhost(entities, onlyType, data.lane, lane, beatOffset, modifiers.shift)
    },

    async tap(x, y, modifiers) {
        const data = clipboardEntry.value?.data
        if (!data) return

        await pasteAtPosition(xToLane(x), yToBeatOffset(y, data.beat), modifiers)
    },

    cursor() {
        const data = clipboardEntry.value?.data
        return data && cachedTransform(data).length ? 'copy' : 'default'
    },

    dragStart(x, y, modifiers) {
        const data = clipboardEntry.value?.data
        if (!data) return false

        const entities = transform(data)
        if (!entities.length) return false

        active = {
            lane: data.lane,
            beat: data.beat,
            entities,
            onlyType: getOnlyEntityType(entities),
        }

        const lane = xToLane(x)
        const beatOffset = toPasteBeatOffset(
            landing(active.entities),
            yToBeatOffset(y, active.beat),
        )

        showGhost(active.entities, active.onlyType, active.lane, lane, beatOffset, modifiers.shift)

        return true
    },

    dragUpdate(x, y, modifiers) {
        if (!active) return false

        const lane = xToLane(x)
        const beatOffset = toPasteBeatOffset(
            landing(active.entities),
            yToBeatOffset(y, active.beat),
        )

        showGhost(active.entities, active.onlyType, active.lane, lane, beatOffset, modifiers.shift)
    },

    async dragEnd(x, y, modifiers) {
        if (!active) return

        if (active.entities.some(isEventJoint)) await checkDynamicStages()

        revealPasteTargets(active.entities)
        const transaction = createTransaction(state.value)

        const lane = xToLane(x)
        const beatOffset = toPasteBeatOffset(
            landing(active.entities),
            yToBeatOffset(y, active.beat),
        )

        const selectedEntities: Entity[] = []
        for (const entity of active.entities) {
            const beat = entity.beat + beatOffset

            const result = pastes[entity.type]?.(
                transaction,
                active.onlyType,
                entity as never,
                active.lane,
                lane,
                beat,
                modifiers.shift,
                selectedEntities,
            )
            if (!result) continue

            selectedEntities.push(...result)
        }

        pushState(
            interpolate(() => i18n.value.tools.paste.pasted, `${selectedEntities.length}`),
            transaction.commit(selectedEntities),
        )
        view.entities = {
            hovered: [],
            creating: [],
        }
        clearPasteGhost()

        notify(interpolate(() => i18n.value.tools.paste.pasted, `${selectedEntities.length}`))

        active = undefined
    },

    dragCancel() {
        active = undefined
        clearPasteGhost()
    },
}

let ghost:
    | {
          slides: NoteObject[][]
          bpms: BpmIntegral[]
          pastedBpms: BpmObject[]
          entities: Entity[]
          infos: StoreSlides['info']
      }
    | undefined

/** The ghost's slides, for drawing their notes as they'll land. */
export const pasteGhostInfos = () => ghost?.infos

/** Drops the ghost once it no longer shows. */
export const clearPasteGhost = () => {
    ghost = undefined
}

const isSameSlides = (a: NoteObject[][], b: NoteObject[][]) =>
    a.length === b.length &&
    a.every((slide, i) => {
        const other = b[i]
        return (
            slide.length === other?.length &&
            slide.every((note, j) => {
                const otherNote = other[j] as Record<string, unknown> | undefined
                return Object.entries(note).every(([key, value]) => otherNote?.[key] === value)
            })
        )
    })

// Each pasted BPM replaces the first unpasted one at its beat and follows any left there.
const toGhostBpms = (bpms: BpmIntegral[], pasted: BpmObject[]) => {
    if (!pasted.length) return bpms
    const added = new Set<BpmIntegral>()
    const integrals = [...bpms]
    for (const object of pasted) {
        const overlap = integrals.findIndex(
            (integral) => integral.x === object.beat && !added.has(integral),
        )
        if (overlap >= 0) integrals.splice(overlap, 1)
        let index = bisect(integrals, 'x', object.beat)
        while (integrals[index]?.x === object.beat) index++
        const integral = toBpmIntegral(object)
        added.add(integral)
        integrals.splice(index, 0, integral)
    }
    return calculateBpms(integrals)
}

const isSameBpms = (a: BpmObject[], b: BpmObject[]) =>
    a.length === b.length &&
    a.every((bpm, i) => bpm.beat === b[i]?.beat && bpm.bpm === b[i].bpm && bpm.meter === b[i].meter)

// Slides land whole: their connectors and attached ticks as a paste places them.
const showGhost = (
    entities: Entity[],
    onlyType: EntityType | undefined,
    startLane: number,
    lane: number,
    beatOffset: number,
    flip: boolean,
) => {
    const creating: Entity[] = []
    const slides = new Map<SlideId, NoteObject[]>()
    const pastedBpms: BpmObject[] = []
    for (const entity of entities) {
        const beat = entity.beat + beatOffset
        if (!isLanding(entity)) continue
        if (entity.type === 'bpm') pastedBpms.push(toMovedBpmObject(entity, beat))
        if (entity.type === 'note') {
            const object = toMovedNoteObject(entity, startLane, lane, beat, flip)
            const slide = slides.get(entity.slideId)
            if (slide) slide.push(object)
            else slides.set(entity.slideId, [object])
            continue
        }

        const result = creates[entity.type]?.(
            onlyType,
            entity as never,
            startLane,
            lane,
            beat,
            flip,
        )
        if (result) creating.push(result)
    }

    // Rebuilt only when a note moves to another snapped place or the tempo changes,
    // the paste's own BPMs included, which land first.
    const { bpms } = state.value
    const objects = [...slides.values()]
    if (
        ghost?.bpms !== bpms ||
        !isSameBpms(ghost.pastedBpms, pastedBpms) ||
        !isSameSlides(ghost.slides, objects)
    ) {
        const { slides: built } = createStore(
            { ...emptyChart(), slides: objects },
            toGhostBpms(bpms, pastedBpms),
        )
        ghost = {
            slides: objects,
            bpms,
            pastedBpms,
            entities: [...[...built.connector.values()].flat(), ...[...built.note.values()].flat()],
            infos: built.info,
        }
    }

    view.entities = {
        hovered: [],
        creating: [...ghost.entities, ...creating],
    }
}

const emptyChart = (): Chart => ({
    initialLife: 1000,
    isDynamicStages: false,
    bpms: [],
    groups: new Map(),
    stages: new Map(),
    cameraEvents: [],
    stageMaskEvents: [],
    stagePivotEvents: [],
    stageStyleEvents: [],
    stageTransformEvents: [],
    timeScales: [],
    slides: [],
})

// Authoring reveals its target: pasted objects land in the focused group/stage
// or keep their own, and must neither vanish nor replace hidden objects (a
// pasted time scale replaces one at the same beat of its group).
const revealPasteTargets = (entities: Entity[]) => {
    for (const entity of entities) {
        const { groupId, stageId } = entityScopeIds(entity)
        revealAuthoringTarget({
            groupId: groupId === undefined ? undefined : (view.groupId ?? groupId),
            stageId: stageId === undefined ? undefined : (view.stageId ?? stageId),
        })
    }
}

const isEventJoint = (entity: Entity) =>
    entity.type === 'cameraEventJoint' ||
    entity.type === 'stageMaskEventJoint' ||
    entity.type === 'stagePivotEventJoint' ||
    entity.type === 'stageStyleEventJoint' ||
    entity.type === 'stageTransformEventJoint'

// Event joints land only with dynamic stages.
const isLanding = (entity: Entity) => isDynamicStages.value || !isEventJoint(entity)
const landing = (entities: Entity[]) => entities.filter(isLanding)

/** Shifts a paste later so its earliest object lands no earlier than beat 0. */
export const toPasteBeatOffset = (entities: readonly { beat: number }[], beatOffset: number) =>
    entities.reduce((offset, entity) => Math.max(offset, -entity.beat), beatOffset)

export type PastePositionOptions = {
    notesOnly?: boolean
    mapNote?: (entity: NoteEntity, beat: number) => Partial<NoteObject>
}

export const pasteAtPosition = async (
    lane: number,
    beatOffset: number,
    modifiers: Modifiers,
    options: PastePositionOptions = {},
) => {
    const data = clipboardEntry.value?.data
    if (!data) return

    const entities = transform(data).filter(
        (entity) => !options.notesOnly || entity.type === 'note',
    )
    if (!entities.length) return

    if (entities.some(isEventJoint)) await checkDynamicStages()

    revealPasteTargets(entities)
    const transaction = createTransaction(state.value)

    const onlyType = getOnlyEntityType(entities)
    const shiftedOffset = toPasteBeatOffset(landing(entities), beatOffset)

    const selectedEntities: Entity[] = []
    for (const entity of entities) {
        const beat = entity.beat + shiftedOffset

        if (entity.type === 'note' && options.mapNote) {
            selectedEntities.push(
                ...addNote(transaction, entity.slideId, {
                    ...toMovedNoteObject(entity, data.lane, lane, beat, modifiers.shift),
                    ...options.mapNote(entity, beat),
                }),
            )
            continue
        }

        const result = pastes[entity.type]?.(
            transaction,
            onlyType,
            entity as never,
            data.lane,
            lane,
            beat,
            modifiers.shift,
            selectedEntities,
        )
        if (!result) continue

        selectedEntities.push(...result)
    }

    pushState(
        interpolate(() => i18n.value.tools.paste.pasted, `${selectedEntities.length}`),
        transaction.commit(selectedEntities),
    )
    view.entities = {
        hovered: [],
        creating: [],
    }
    clearPasteGhost()

    notify(interpolate(() => i18n.value.tools.paste.pasted, `${selectedEntities.length}`))
}

type ClipboardChart = { chart: Chart; source?: ClipboardData['source'] }

// Pastes into the copying chart keep their own groups and stages; others map by position.
const mapIds = <T extends number>(
    pasted: Iterable<T>,
    current: ReadonlyMap<T, unknown>,
    own?: readonly number[],
) => {
    const ids = [...current.keys()]
    return new Map(
        [...pasted].map((id, index) => {
            const target = (own ? own[index] : ids[index]) as T | undefined
            return [id, target !== undefined && current.has(target) ? target : undefined]
        }),
    )
}

const transform = ({ chart, source }: ClipboardChart) => {
    const same = source?.chart === chartSessionId()
    const groupMappings = mapIds(
        chart.groups.keys(),
        groups.value,
        same ? source.groups : undefined,
    )
    const stageMappings = mapIds(
        chart.stages.keys(),
        stages.value,
        same ? source.stages : undefined,
    )

    const mapGroupId = <T extends { groupId: GroupId }>(object: T) => ({
        ...object,
        groupId: groupMappings.get(object.groupId) ?? defaultGroupId.value,
    })

    const mapStageId = <T extends { stageId: StageId }>(object: T) => ({
        ...object,
        stageId: stageMappings.get(object.stageId) ?? defaultStageId.value,
    })

    return [
        ...chart.bpms.map(toBpmEntity),
        ...chart.timeScales.map(mapGroupId).map(toTimeScaleEntity),

        ...chart.cameraEvents.map(toCameraEventJointEntity),

        ...chart.stageMaskEvents.map(mapStageId).map(toStageMaskEventJointEntity),
        ...chart.stagePivotEvents.map(mapStageId).map(toStagePivotEventJointEntity),
        ...chart.stageStyleEvents.map(mapStageId).map(toStageStyleEventJointEntity),
        ...chart.stageTransformEvents.map(mapStageId).map(toStageTransformEventJointEntity),

        ...chart.slides.flatMap((slide) => {
            const slideId = createSlideId()

            return slide
                .map(mapGroupId)
                .map(mapStageId)
                .map((note) => toNoteEntity(slideId, note))
        }),
    ]
}

export const getPasteNoteEntities = () => {
    const data = clipboardEntry.value?.data
    return data
        ? cachedTransform(data).filter((entity): entity is NoteEntity => entity.type === 'note')
        : []
}

let transformCache:
    | {
          data: ClipboardChart
          keys: unknown[]
          entities: Entity[]
      }
    | undefined

const cachedTransform = (data: ClipboardChart) => {
    // Mappings follow the chart's groups and stages too.
    const keys = [groups.value, stages.value, chartSessionId()]
    if (
        transformCache?.data !== data ||
        transformCache.keys.some((key, index) => key !== keys[index])
    ) {
        transformCache = {
            data,
            keys,
            entities: transform(data),
        }
    }

    return transformCache.entities
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
    flip: boolean,
): TimeScaleObject =>
    constrainLaneObject({
        ...entity,
        groupId: view.groupId ?? entity.groupId,
        beat,
        editorLane:
            onlyType === 'timeScale'
                ? flip
                    ? alignComputed(-entity.editorLane + alignLane(startLane) + alignLane(lane))
                    : alignComputed(entity.editorLane - alignLane(startLane) + alignLane(lane))
                : entity.editorLane,
    })

const toMovedCameraEventObject = (
    entity: CameraEventJointEntity,
    startLane: number,
    lane: number,
    beat: number,
    flip: boolean,
): CameraEventObject =>
    constrainLaneObject({
        ...entity,
        beat,
        cameraLeft: flip
            ? alignComputed(
                  -(entity.cameraLeft + entity.cameraSize) + alignLane(startLane) + alignLane(lane),
              )
            : alignComputed(entity.cameraLeft - alignLane(startLane) + alignLane(lane)),
        cameraZoomTargetLane: flip ? -entity.cameraZoomTargetLane : entity.cameraZoomTargetLane,
        cameraRotation: flip ? -entity.cameraRotation : entity.cameraRotation,
    })

const toMovedStageMaskEventObject = (
    entity: StageMaskEventJointEntity,
    startLane: number,
    lane: number,
    beat: number,
    flip: boolean,
): StageMaskEventObject =>
    constrainLaneObject({
        ...entity,
        stageId: view.stageId ?? entity.stageId,
        beat,
        maskLeft: flip
            ? alignComputed(
                  -(entity.maskLeft + entity.maskSize) + alignLane(startLane) + alignLane(lane),
              )
            : alignComputed(entity.maskLeft - alignLane(startLane) + alignLane(lane)),
    })

const toMovedStagePivotEventObject = (
    entity: StagePivotEventJointEntity,
    startLane: number,
    lane: number,
    beat: number,
    flip: boolean,
): StagePivotEventObject =>
    constrainLaneObject({
        ...entity,
        stageId: view.stageId ?? entity.stageId,
        beat,
        pivotLane: flip
            ? alignComputed(-entity.pivotLane + alignLane(startLane) + alignLane(lane))
            : alignComputed(entity.pivotLane - alignLane(startLane) + alignLane(lane)),
    })

const toMovedStageStyleEventObject = (
    onlyType: EntityType | undefined,
    entity: StageStyleEventJointEntity,
    startLane: number,
    lane: number,
    beat: number,
    flip: boolean,
): StageStyleEventObject =>
    constrainLaneObject({
        ...entity,
        stageId: view.stageId ?? entity.stageId,
        beat,
        editorLane:
            onlyType === 'stageStyleEventJoint'
                ? flip
                    ? alignComputed(-entity.editorLane + alignLane(startLane) + alignLane(lane))
                    : alignComputed(entity.editorLane - alignLane(startLane) + alignLane(lane))
                : entity.editorLane,
        leftBorderStyle: flip ? entity.rightBorderStyle : entity.leftBorderStyle,
        rightBorderStyle: flip ? entity.leftBorderStyle : entity.rightBorderStyle,
    })

const toMovedStageTransformEventObject = (
    entity: StageTransformEventJointEntity,
    startLane: number,
    lane: number,
    beat: number,
    flip: boolean,
): StageTransformEventObject =>
    constrainLaneObject({
        ...entity,
        stageId: view.stageId ?? entity.stageId,
        beat,
        rotation: flip ? -entity.rotation : entity.rotation,
        xTranslation: flip
            ? alignComputed(-entity.xTranslation + alignLane(startLane) + alignLane(lane))
            : alignComputed(entity.xTranslation - alignLane(startLane) + alignLane(lane)),
    })

const flippedFlickDirections: Record<FlickDirection, FlickDirection> = {
    none: 'none',
    up: 'up',
    upLeft: 'upRight',
    upRight: 'upLeft',
    down: 'down',
    downLeft: 'downRight',
    downRight: 'downLeft',
}

export const toMovedNoteObject = (
    entity: NoteEntity,
    startLane: number,
    lane: number,
    beat: number,
    flip: boolean,
    limited = true,
): NoteObject =>
    constrainLaneObject(
        {
            ...entity,
            groupId: view.groupId ?? entity.groupId,
            stageId: view.stageId ?? entity.stageId,
            beat,
            left: flip
                ? alignComputed(
                      -(entity.left + entity.size) + alignLane(startLane) + alignLane(lane),
                  )
                : alignComputed(entity.left - alignLane(startLane) + alignLane(lane)),
            flickDirection: flip
                ? flippedFlickDirections[entity.flickDirection]
                : entity.flickDirection,
        },
        { enabled: limited },
    )

type Create<T extends Entity> = (
    onlyType: EntityType | undefined,
    entity: T,
    startLane: number,
    lane: number,
    beat: number,
    flip: boolean,
) => Entity | undefined

const creates: {
    [T in Entity as T['type']]: Create<T> | undefined
} = {
    bpm: (onlyType, entity, startLane, lane, beat) => toBpmEntity(toMovedBpmObject(entity, beat)),
    timeScale: (onlyType, entity, startLane, lane, beat, flip) =>
        toTimeScaleEntity(toMovedTimeScaleObject(onlyType, entity, startLane, lane, beat, flip)),

    cameraEventJoint: (onlyType, entity, startLane, lane, beat, flip) =>
        toCameraEventJointEntity(toMovedCameraEventObject(entity, startLane, lane, beat, flip)),
    cameraEventConnection: undefined,

    stageMaskEventJoint: (onlyType, entity, startLane, lane, beat, flip) =>
        toStageMaskEventJointEntity(
            toMovedStageMaskEventObject(entity, startLane, lane, beat, flip),
        ),
    stageMaskEventConnection: undefined,

    stagePivotEventJoint: (onlyType, entity, startLane, lane, beat, flip) =>
        toStagePivotEventJointEntity(
            toMovedStagePivotEventObject(entity, startLane, lane, beat, flip),
        ),
    stagePivotEventConnection: undefined,

    stageStyleEventJoint: (onlyType, entity, startLane, lane, beat, flip) =>
        toStageStyleEventJointEntity(
            toMovedStageStyleEventObject(onlyType, entity, startLane, lane, beat, flip),
        ),
    stageStyleEventConnection: undefined,

    stageTransformEventJoint: (onlyType, entity, startLane, lane, beat, flip) =>
        toStageTransformEventJointEntity(
            toMovedStageTransformEventObject(entity, startLane, lane, beat, flip),
        ),
    stageTransformEventConnection: undefined,

    note: (onlyType, entity, startLane, lane, beat, flip) =>
        toNoteEntity(entity.slideId, toMovedNoteObject(entity, startLane, lane, beat, flip)),
    connector: undefined,
}

type Paste<T extends Entity> = (
    transaction: Transaction,
    onlyType: EntityType | undefined,
    entity: T,
    startLane: number,
    lane: number,
    beat: number,
    flip: boolean,
    /** Objects already placed by this paste; they never replace each other. */
    batch: readonly Entity[],
) => Entity[] | undefined

const pastes: {
    [T in Entity as T['type']]: Paste<T> | undefined
} = {
    bpm: (transaction, onlyType, entity, startLane, lane, beat, flip, batch) => {
        const object = toMovedBpmObject(entity, beat)

        const overlap = getInStoreGrid(transaction.store.grid, 'bpm', object.beat)?.find(
            (entity) => entity.beat === object.beat && !batch.includes(entity),
        )
        if (overlap) removeBpm(transaction, overlap)

        return addBpm(transaction, object)
    },
    timeScale: (transaction, onlyType, entity, startLane, lane, beat, flip, batch) => {
        const object = toMovedTimeScaleObject(onlyType, entity, startLane, lane, beat, flip)

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

    cameraEventJoint: (transaction, onlyType, entity, startLane, lane, beat, flip) => {
        if (!isDynamicStages.value) return

        const object = toMovedCameraEventObject(entity, startLane, lane, beat, flip)

        return addCameraEventJoint(transaction, object)
    },
    cameraEventConnection: undefined,

    stageMaskEventJoint: (transaction, onlyType, entity, startLane, lane, beat, flip) => {
        if (!isDynamicStages.value) return

        const object = toMovedStageMaskEventObject(entity, startLane, lane, beat, flip)

        return addStageMaskEventJoint(transaction, object)
    },
    stageMaskEventConnection: undefined,

    stagePivotEventJoint: (transaction, onlyType, entity, startLane, lane, beat, flip) => {
        if (!isDynamicStages.value) return

        const object = toMovedStagePivotEventObject(entity, startLane, lane, beat, flip)

        return addStagePivotEventJoint(transaction, object)
    },
    stagePivotEventConnection: undefined,

    stageStyleEventJoint: (transaction, onlyType, entity, startLane, lane, beat, flip) => {
        if (!isDynamicStages.value) return

        const object = toMovedStageStyleEventObject(onlyType, entity, startLane, lane, beat, flip)

        return addStageStyleEventJoint(transaction, object)
    },
    stageStyleEventConnection: undefined,

    stageTransformEventJoint: (transaction, onlyType, entity, startLane, lane, beat, flip) => {
        if (!isDynamicStages.value) return

        const object = toMovedStageTransformEventObject(entity, startLane, lane, beat, flip)

        return addStageTransformEventJoint(transaction, object)
    },
    stageTransformEventConnection: undefined,

    note: (transaction, onlyType, entity, startLane, lane, beat, flip) => {
        const object = toMovedNoteObject(entity, startLane, lane, beat, flip)

        return addNote(transaction, entity.slideId, object)
    },
    connector: undefined,
}
