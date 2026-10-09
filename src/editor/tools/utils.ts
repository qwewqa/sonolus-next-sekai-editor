import { hitAllEntities, hitEntities, store } from '../../history/store'
import type { Entity, EntityType } from '../../state/entities'
import { editChanges } from '../../state/operations/properties/plan'
import { alignComputed, clamp, shiftComputed } from '../../utils/math'
import { getComposedLayout } from '../composedView'
import type { CanvasCursor } from '../controls/cursor'
import type { Modifiers } from '../controls/gestures/pointer'
import { editorNavigation } from '../navigation'
import { clearNotification } from '../notification'
import { isEntityInScope } from '../scope'
import { snappedOffset } from '../snapping'
import { view, xToLane, yToTime, type Selection } from '../view'

export { isNoteResizeStart, isRangeResizeStart, isSelectResize } from './edges'

export const placementCursors: Record<'add' | 'edit' | 'move', CanvasCursor> = {
    add: 'crosshair',
    edit: 'ew-resize',
    move: 'move',
}

export const offset = (startLane: number, lane: number, anchor = startLane, origin = 0) =>
    snappedOffset(startLane, lane, anchor - origin, view.laneDivision, view.laneSnapping)

// A lane moved by the drag's offset, without float noise; unmoved, it stays exact.
export const moveLane = (
    value: number,
    startLane: number,
    lane: number,
    anchor?: number,
    origin = 0,
) => shiftComputed(value, offset(startLane, lane, anchor, origin))

/** Commits a drop; one that changes nothing adds no undo step, and its notice goes. */
export const commitDrop = <E extends Entity, O extends object>(
    commit: (entity: E, object: O) => void,
    entity: E,
    object: O,
) => {
    if (editChanges(store.value, entity, object)) {
        commit(entity, object)
        return
    }
    view.entities = { hovered: [], creating: [] }
    clearNotification()
}

export const getLaneAnchor = (entity: Entity) => {
    switch (entity.type) {
        case 'note':
            return entity.left
        case 'connector':
            return entity.head.left
        case 'cameraEventJoint':
            return entity.cameraLeft
        case 'stageMaskEventJoint':
            return entity.maskLeft
        case 'stagePivotEventJoint':
            return entity.pivotLane
        case 'stageTransformEventJoint':
            return entity.xTranslation
        case 'timeScale':
        case 'stageStyleEventJoint':
            return entity.editorLane
        case 'bpm':
        case 'cameraEventConnection':
        case 'stageMaskEventConnection':
        case 'stagePivotEventConnection':
        case 'stageStyleEventConnection':
        case 'stageTransformEventConnection':
            return undefined
    }
}

export const resize = (
    anchor: number,
    lane: number,
    min = 0,
    max = Number.POSITIVE_INFINITY,
    startEdge = anchor,
    original?: readonly [left: number, size: number],
    origin = 0,
) => {
    const shift = offset(startEdge, lane, startEdge, origin)
    // An edge dragged back to its start keeps the values exactly.
    if (original && shift === 0) return original
    const edge = startEdge + shift
    const size = clamp(alignComputed(Math.abs(edge - anchor)), min, max)

    // The fixed edge stays as given; callers snap one that is a sum.
    return [lane >= anchor ? anchor : alignComputed(anchor - size), size] as const
}

export const hitEntitiesAtPoint = <T extends EntityType>(
    type: T,
    x: number,
    y: number,
    minimumNoteWidth = 1.5,
) => {
    if (editorNavigation.value)
        return editorNavigation.value
            .hitPoint(x, y, minimumNoteWidth)
            .filter((entity): entity is Extract<Entity, { type: T }> => entity.type === type)
    return filterPointHits(
        hitEntities(
            type,
            xToLane(x - 10),
            xToLane(x + 10),
            yToTime(y + 10),
            yToTime(y - 10),
            minimumNoteWidth,
        ),
        x,
        minimumNoteWidth,
    )
}

// Point priority is independent of storage and drawing order; ties keep their order.
const pointHitOrder: EntityType[] = [
    'note',
    'stageTransformEventJoint',
    'stageStyleEventJoint',
    'stagePivotEventJoint',
    'stageMaskEventJoint',
    'cameraEventJoint',
    'timeScale',
    'bpm',
]

export const comparePointHits = (a: Entity, b: Entity) =>
    pointHitOrder.indexOf(a.type) - pointHitOrder.indexOf(b.type)

export const hitAllEntitiesAtPoint = (x: number, y: number, minimumNoteWidth = 1.5) => {
    if (editorNavigation.value) return editorNavigation.value.hitPoint(x, y, minimumNoteWidth)
    return filterPointHits(
        hitAllEntities(
            xToLane(x - 10),
            xToLane(x + 10),
            yToTime(y + 10),
            yToTime(y - 10),
            minimumNoteWidth,
        ),
        x,
        minimumNoteWidth,
    ).sort(comparePointHits)
}

const filterPointHits = <T extends Entity>(entities: T[], x: number, minimumNoteWidth: number) => {
    const hits = entities.filter(isVisible)
    const lane = xToLane(x)
    const composed = getComposedLayout()
    const isDirectNote = (entity: T) => {
        const hitbox = composed ? composed.hitbox(entity) : entity.hitbox
        return (
            entity.type === 'note' &&
            hitbox &&
            lane >= hitbox.lane - Math.max(hitbox.w, minimumNoteWidth / 2) &&
            lane <= hitbox.lane + Math.max(hitbox.w, minimumNoteWidth / 2)
        )
    }
    return hits.some(isDirectNote)
        ? hits.filter((entity) => entity.type !== 'note' || isDirectNote(entity))
        : hits
}

export const hitEntitiesInSelection = <T extends EntityType>(type: T, selection: Selection) =>
    hitEntities(
        type,
        selection.laneMin,
        selection.laneMax,
        selection.timeMin,
        selection.timeMax,
    ).filter(isVisible)

export const hitAllEntitiesInSelection = (selection: Selection) =>
    hitAllEntities(
        selection.laneMin,
        selection.laneMax,
        selection.timeMin,
        selection.timeMax,
    ).filter(isVisible)

export const modifyEntities = (entities: Entity[], modifiers: Modifiers) => {
    if (!modifiers.shift) return entities

    const allEntities = new Set(entities)

    for (const entity of entities) {
        if (entity.type !== 'note') continue

        const notes = store.value.slides.note.get(entity.slideId)
        if (!notes) continue

        // Slides can span groups and stages; never extend into hidden ones.
        for (const note of notes) {
            if (isEntityInScope(note)) allEntities.add(note)
        }
    }

    return [...allEntities]
}

export const toSelection = (startLane: number, startTime: number, x: number, y: number) => {
    let laneMin = startLane
    let timeMin = startTime
    let laneMax = xToLane(x)
    let timeMax = yToTime(y)

    if (laneMin > laneMax) [laneMin, laneMax] = [laneMax, laneMin]
    if (timeMin > timeMax) [timeMin, timeMax] = [timeMax, timeMin]

    return {
        laneMin,
        laneMax,
        timeMin,
        timeMax,
    }
}

/**
 * Whether an entity can be hovered, hit-tested, selected and edited: its type
 * is shown and its group and stage scopes are fully visible. Dimmed entities
 * are drawn but never interactive; connectors and event connections are never
 * hit directly.
 */
export const isVisible = (entity: Entity) => {
    if (!view.visibilities[entity.type]) return false

    switch (entity.type) {
        case 'cameraEventConnection':
        case 'stageMaskEventConnection':
        case 'stagePivotEventConnection':
        case 'stageStyleEventConnection':
        case 'stageTransformEventConnection':
        case 'connector':
            return false
        case 'bpm':
        case 'timeScale':
        case 'cameraEventJoint':
        case 'stageMaskEventJoint':
        case 'stagePivotEventJoint':
        case 'stageStyleEventJoint':
        case 'stageTransformEventJoint':
        case 'note':
            return isEntityInScope(entity)
    }
}
