import { hitAllEntities, hitEntities, store } from '../../history/store'
import type { Entity, EntityType } from '../../state/entities'
import { getNoteInteractionWidth } from '../../state/entities/slides/note'
import { clamp } from '../../utils/math'
import type { Modifiers } from '../controls/gestures/pointer'
import { editorNavigation } from '../navigation'
import { snappedOffset } from '../snapping'
import { view, xToLane, yToTime, type Selection } from '../view'

export const offset = (startLane: number, lane: number, anchor = startLane) =>
    snappedOffset(startLane, lane, anchor, view.laneDivision, view.laneSnapping)

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

export const isNoteResizeStart = (note: { left: number; size: number }, lane: number) => {
    const center = note.left + note.size / 2
    const moveHalfWidth = getNoteInteractionWidth(note.size) / 2 - 0.5
    return lane <= center - moveHalfWidth || lane >= center + moveHalfWidth
}

export const resize = (
    anchor: number,
    lane: number,
    min = 0,
    max = Number.POSITIVE_INFINITY,
    startEdge = anchor,
) => {
    const edge = startEdge + offset(startEdge, lane, startEdge)
    const size = clamp(Math.abs(edge - anchor), min, max)

    return [anchor - (lane >= anchor ? 0 : size), size] as const
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
    )
}

const filterPointHits = <T extends Entity>(entities: T[], x: number, minimumNoteWidth: number) => {
    const hits = entities.filter(isVisible)
    const lane = xToLane(x)
    const isDirectNote = (entity: T) =>
        entity.type === 'note' &&
        entity.hitbox &&
        lane >= entity.hitbox.lane - Math.max(entity.hitbox.w, minimumNoteWidth / 2) &&
        lane <= entity.hitbox.lane + Math.max(entity.hitbox.w, minimumNoteWidth / 2)
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

        for (const note of notes) {
            allEntities.add(note)
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

const isVisible = (entity: Entity) => {
    if (!view.visibilities[entity.type]) return false

    switch (entity.type) {
        case 'bpm':
        case 'cameraEventJoint':
            return true
        case 'timeScale':
            return view.groupId === undefined || entity.groupId === view.groupId
        case 'stageMaskEventJoint':
        case 'stagePivotEventJoint':
        case 'stageStyleEventJoint':
        case 'stageTransformEventJoint':
            return view.stageId === undefined || entity.stageId === view.stageId
        case 'note':
            return (
                (view.groupId === undefined || entity.groupId === view.groupId) &&
                (view.stageId === undefined || entity.stageId === view.stageId)
            )
        case 'cameraEventConnection':
        case 'stageMaskEventConnection':
        case 'stagePivotEventConnection':
        case 'stageStyleEventConnection':
        case 'stageTransformEventConnection':
        case 'connector':
            return false
    }
}
