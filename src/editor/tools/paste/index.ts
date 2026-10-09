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
import { settings } from '../../../settings'
import type { State } from '../../../state'
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
import { align, alignComputed, shiftComputed } from '../../../utils/math'
import { bisect } from '../../../utils/ordered'
import { createComposedLayout } from '../../composed'
import { inverseAffine } from '../../composedPointer'
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
          anchor: ClipboardChart['anchor']
      }
    | undefined
// Where the hover last read the clipboard.
let readAt: { x: number; y: number } | undefined

export const paste: Tool = {
    title: () => i18n.value.tools.paste.title,
    sidebar: PasteSidebar,

    hover(x, y, modifiers) {
        // Only a pointer move reads the clipboard; a scroll under a still pointer reuses what it read.
        if (x !== readAt?.x || y !== readAt.y) void updateClipboard()
        readAt = { x, y }

        const data = clipboardEntry.value?.data
        if (!data) return

        const entities = cachedTransform(data)
        if (!entities.length) return

        const onlyType = getOnlyEntityType(entities)
        const lane = xToLane(x)
        const beatOffset = toPasteBeatOffset(landing(entities), yToBeatOffset(y, data.beat))

        showGhost(
            entities,
            onlyType,
            data.lane,
            lane,
            beatOffset,
            modifiers.shift,
            data.anchor,
            data.beat,
        )
    },

    async tap(x, y, modifiers) {
        const data = clipboardEntry.value?.data
        if (!data) return

        await pasteAtPosition(xToLane(x), yToBeatOffset(y, data.beat), modifiers, {
            composed: true,
        })
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
            anchor: data.anchor,
        }

        const lane = xToLane(x)
        const beatOffset = toPasteBeatOffset(
            landing(active.entities),
            yToBeatOffset(y, active.beat),
        )

        showGhost(
            active.entities,
            active.onlyType,
            active.lane,
            lane,
            beatOffset,
            modifiers.shift,
            active.anchor,
            active.beat,
        )

        return true
    },

    dragUpdate(x, y, modifiers) {
        if (!active) return false

        const lane = xToLane(x)
        const beatOffset = toPasteBeatOffset(
            landing(active.entities),
            yToBeatOffset(y, active.beat),
        )

        showGhost(
            active.entities,
            active.onlyType,
            active.lane,
            lane,
            beatOffset,
            modifiers.shift,
            active.anchor,
            active.beat,
        )
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

        if (isComposedPaste()) {
            finishPaste(
                buildComposedPaste(
                    active.entities,
                    active.onlyType,
                    active.lane,
                    lane,
                    beatOffset,
                    modifiers.shift,
                    active.anchor,
                    active.beat,
                ),
            )
            active = undefined
            return
        }

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
          state?: State
      }
    | undefined
let composedGhostKeys: unknown[] | undefined

/** The ghost's slides, for drawing their notes as they'll land. */
export const pasteGhostInfos = () => ghost?.infos

/** Includes the pasted events that determine a composed ghost's stage positions. */
export const pasteGhostState = () => ghost?.state

/** Drops the ghost once it no longer shows. */
export const clearPasteGhost = () => {
    ghost = undefined
    composedGhostKeys = undefined
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
    anchorIndex?: number,
    anchorBeat = 0,
) => {
    if (isComposedPaste()) {
        const keys = [
            state.value,
            entities,
            startLane,
            lane,
            beatOffset,
            flip,
            anchorIndex,
            anchorBeat,
            view.groupId,
            view.stageId,
            settings.maxLane,
            view.laneDivision,
        ]
        if (ghost?.state && composedGhostKeys?.every((key, index) => key === keys[index])) {
            view.entities = { hovered: [], creating: ghost.entities }
            return
        }
        const result = buildComposedPaste(
            entities,
            onlyType,
            startLane,
            lane,
            beatOffset,
            flip,
            anchorIndex,
            anchorBeat,
        )
        const notes = result.selectedEntities.filter((entity) => entity.type === 'note')
        const ids = new Set(notes.map((note) => note.slideId))
        const creating = [
            ...[...ids].flatMap((id) => result.store.slides.connector.get(id) ?? []),
            ...result.selectedEntities,
        ]
        ghost = {
            slides: [],
            bpms: result.bpms,
            pastedBpms: [],
            entities: creating,
            infos: result.store.slides.info,
            state: result,
        }
        composedGhostKeys = keys
        view.entities = { hovered: [], creating }
        return
    }
    if (ghost?.state) clearPasteGhost()
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
    /** The main chart canvas supplies display lanes; elevation keeps its own mapping. */
    composed?: boolean
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

    if (options.composed && isComposedPaste()) {
        finishPaste(
            buildComposedPaste(
                entities,
                onlyType,
                data.lane,
                lane,
                shiftedOffset,
                modifiers.shift,
                data.anchor,
                data.beat,
            ),
        )
        return
    }

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

type ClipboardChart = {
    chart: Chart
    source?: ClipboardData['source']
    anchor?: number
}

const isComposedPaste = () => view.layout === 'composed' && isDynamicStages.value

// Notes and their controls share one authored translation. Probe the complete
// prospective paste so moving its pivot/translation also moves the grabbed note.
const buildComposedPaste = (
    entities: Entity[],
    onlyType: EntityType | undefined,
    startLane: number,
    lane: number,
    beatOffset: number,
    flip: boolean,
    anchorIndex?: number,
    anchorBeat = 0,
) => {
    const notes = entities.filter((entity) => entity.type === 'note')
    if (!notes.length) {
        const transaction = createTransaction(state.value)
        const selected: Entity[] = []
        for (const entity of entities) {
            const added = pastes[entity.type]?.(
                transaction,
                onlyType,
                entity as never,
                startLane,
                lane,
                entity.beat + beatOffset,
                flip,
                selected,
            )
            if (added) selected.push(...added)
        }
        return transaction.commit(selected)
    }
    const focus =
        (anchorIndex === undefined ? undefined : notes[anchorIndex]) ??
        [...notes].sort(
            (a, b) =>
                Math.abs(a.beat - anchorBeat) - Math.abs(b.beat - anchorBeat) ||
                Math.abs(a.left + a.size / 2 - startLane) -
                    Math.abs(b.left + b.size / 2 - startLane),
        )[0]
    if (!focus) return state.value
    const focusIndex = notes.indexOf(focus)
    const pasteAtDelta = (delta: number, limited = false) =>
        pasteAuthored(entities, startLane, beatOffset, flip, delta, limited)
    // These probes must neither snap nor clamp: either changes the response slope.
    const base = pasteAtDelta(0)
    const target = base.selectedEntities.filter((entity) => entity.type === 'note')[focusIndex]
    if (!target) return base
    const layout = createComposedLayout(base)
    const position = layout.notePosition(target)
    const probe = pasteAtDelta(1)
    const probeTarget = probe.selectedEntities.filter((entity) => entity.type === 'note')[
        focusIndex
    ]
    if (!probeTarget) return base
    const sourceLeft = flip ? 2 * startLane - focus.left - focus.size : focus.left
    const grasp = startLane - sourceLeft
    const solved = inverseAffine(
        lane - grasp,
        { input: 0, output: position.left },
        { input: 1, output: createComposedLayout(probe).notePosition(probeTarget).left },
    )
    // A cancelled response cannot follow the pointer; retain the baseline instead
    // of inventing a different translation for the note and its stage controls.
    if (solved === undefined) return pasteAtDelta(0, true)
    const phase = layout.gridOffset(target.stageId, target.beat)
    const snappedLeft = phase + align(target.left + solved - phase, view.laneDivision)
    const delta = snappedLeft - target.left
    return pasteAtDelta(delta, true)
}

/** The same raw edit for every pasted position, with limits only at publication. */
const pasteAuthored = (
    entities: Entity[],
    anchor: number,
    beatOffset: number,
    flip: boolean,
    delta: number,
    limited: boolean,
) => {
    const transaction = createTransaction(state.value)
    const selected: Entity[] = []
    const move = (left: number, size = 0) =>
        limited
            ? flip
                ? alignComputed(2 * anchor - left - size + delta)
                : shiftComputed(left, delta)
            : (flip ? 2 * anchor - left - size : left) + delta
    for (const entity of entities) {
        const common = { ...entity, beat: entity.beat + beatOffset }
        const stageId =
            'stageId' in entity ? (view.stageId ?? entity.stageId) : defaultStageId.value
        const limit = <T extends Parameters<typeof constrainLaneObject>[0]>(object: T) =>
            constrainLaneObject(object, { enabled: limited })
        let added: Entity[] | undefined
        switch (entity.type) {
            case 'bpm':
            case 'timeScale':
                // Mixed selections keep the time-scale editor lane, as in Basic.
                added = pastes[entity.type]?.(
                    transaction,
                    undefined,
                    entity as never,
                    0,
                    0,
                    common.beat,
                    false,
                    selected,
                )
                break
            case 'note':
                added = addNote(
                    transaction,
                    entity.slideId,
                    limit({
                        ...entity,
                        beat: common.beat,
                        stageId,
                        groupId: view.groupId ?? entity.groupId,
                        left: move(entity.left, entity.size),
                        flickDirection: flip
                            ? flippedFlickDirections[entity.flickDirection]
                            : entity.flickDirection,
                    }),
                )
                break
            case 'cameraEventJoint':
                added = addCameraEventJoint(
                    transaction,
                    limit({
                        ...entity,
                        beat: common.beat,
                        cameraLeft: move(entity.cameraLeft, entity.cameraSize),
                        cameraRotation: flip ? -entity.cameraRotation : entity.cameraRotation,
                        cameraZoomTargetLane: flip
                            ? -entity.cameraZoomTargetLane
                            : entity.cameraZoomTargetLane,
                    }),
                )
                break
            case 'stageMaskEventJoint':
                added = addStageMaskEventJoint(
                    transaction,
                    limit({
                        ...entity,
                        beat: common.beat,
                        stageId,
                        maskLeft: move(entity.maskLeft, entity.maskSize),
                    }),
                )
                break
            case 'stagePivotEventJoint':
                added = addStagePivotEventJoint(
                    transaction,
                    limit({
                        ...entity,
                        beat: common.beat,
                        stageId,
                        pivotLane: move(entity.pivotLane),
                    }),
                )
                break
            case 'stageStyleEventJoint':
                added = addStageStyleEventJoint(
                    transaction,
                    limit({
                        ...entity,
                        beat: common.beat,
                        stageId,
                        leftBorderStyle: flip ? entity.rightBorderStyle : entity.leftBorderStyle,
                        rightBorderStyle: flip ? entity.leftBorderStyle : entity.rightBorderStyle,
                    }),
                )
                break
            case 'stageTransformEventJoint':
                added = addStageTransformEventJoint(
                    transaction,
                    limit({
                        ...entity,
                        beat: common.beat,
                        stageId,
                        xTranslation: move(entity.xTranslation),
                        rotation: flip ? -entity.rotation : entity.rotation,
                    }),
                )
                break
            case 'cameraEventConnection':
            case 'stageMaskEventConnection':
            case 'stagePivotEventConnection':
            case 'stageStyleEventConnection':
            case 'stageTransformEventConnection':
            case 'connector':
                break
        }
        if (added) selected.push(...added)
    }
    return transaction.commit(selected)
}

const finishPaste = (result: State) => {
    const message = interpolate(
        () => i18n.value.tools.paste.pasted,
        `${result.selectedEntities.length}`,
    )
    pushState(message, result)
    view.entities = { hovered: [], creating: [] }
    clearPasteGhost()
    notify(message)
}

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
                    : shiftComputed(entity.editorLane, alignLane(lane) - alignLane(startLane))
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
            : shiftComputed(entity.cameraLeft, alignLane(lane) - alignLane(startLane)),
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
            : shiftComputed(entity.maskLeft, alignLane(lane) - alignLane(startLane)),
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
            : shiftComputed(entity.pivotLane, alignLane(lane) - alignLane(startLane)),
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
                    : shiftComputed(entity.editorLane, alignLane(lane) - alignLane(startLane))
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
            : shiftComputed(entity.xTranslation, alignLane(lane) - alignLane(startLane)),
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
                : shiftComputed(entity.left, alignLane(lane) - alignLane(startLane)),
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
