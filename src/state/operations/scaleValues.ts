import type { State } from '..'
import type { Entity } from '../entities'
import { isEditableEntity, type EditableEntity, type EditableProperties } from './editable'

export type ScaleAxis = 'beat' | 'elevation' | 'width'

export const getScaleEntities = (selected: Entity[], axis: ScaleAxis, source?: State) =>
    [...new Set(selected.filter(isEditableEntity))].filter((entity) => {
        if (axis === 'beat') return true
        if (axis === 'width' && entity.type !== 'note') return entity.type !== 'bpm'
        if (entity.type === 'stageTransformEventJoint') return true
        if (entity.type !== 'note') return false
        if (!entity.isAttached) return true
        const slide = source?.store.slides.note.get(entity.slideId)
        return slide?.[0] === entity || slide?.at(-1) === entity
    })

const widthKeys = (
    entity: EditableEntity,
): [keyof EditableProperties, (keyof EditableProperties)?] | undefined => {
    switch (entity.type) {
        case 'note':
            return ['left', 'size']
        case 'cameraEventJoint':
            return ['cameraLeft', 'cameraSize']
        case 'stageMaskEventJoint':
            return ['maskLeft', 'maskSize']
        case 'stagePivotEventJoint':
            return ['pivotLane']
        case 'stageTransformEventJoint':
            return ['xTranslation']
        case 'timeScale':
        case 'stageStyleEventJoint':
            return ['editorLane']
        case 'bpm':
            return undefined
    }
}

export const getScaleValue = (entity: EditableEntity, axis: ScaleAxis): number => {
    if (axis === 'beat') return entity.beat
    if (axis === 'elevation') return 'elevation' in entity ? entity.elevation : NaN
    const keys = widthKeys(entity)
    return keys ? Number((entity as EditableProperties)[keys[0]]) : NaN
}

export const getScaleBounds = (entity: EditableEntity, axis: ScaleAxis) => {
    const min = getScaleValue(entity, axis)
    const sizeKey = axis === 'width' ? widthKeys(entity)?.[1] : undefined
    const size = sizeKey ? Number((entity as EditableProperties)[sizeKey]) : 0
    return { min, max: min + size }
}

export const getScaleProperties = (
    entity: EditableEntity,
    axis: ScaleAxis,
    value: number,
    factor = 1,
): EditableProperties => {
    if (axis !== 'width') return { [axis]: value }
    const keys = widthKeys(entity)
    if (!keys) return {}
    const sizeKey = keys[1]
    return {
        [keys[0]]: value,
        ...(sizeKey ? { [sizeKey]: Number((entity as EditableProperties)[sizeKey]) * factor } : {}),
    }
}

export const getScalePivot = (selected: Entity[], axis: ScaleAxis, source?: State) => {
    let pivot = Infinity
    for (const entity of getScaleEntities(selected, axis, source)) {
        const value = getScaleValue(entity, axis)
        if (!Number.isFinite(value)) return undefined
        pivot = Math.min(pivot, value)
    }
    return Number.isFinite(pivot) ? pivot : undefined
}

export const canScaleSelection = (selected: Entity[], axis: ScaleAxis, source?: State) => {
    const entities = getScaleEntities(selected, axis, source)
    const pivot = getScalePivot(entities, axis, source)
    return (
        entities.length >= (axis === 'width' ? 1 : 2) &&
        pivot !== undefined &&
        entities.every((entity) => {
            const bounds = getScaleBounds(entity, axis)
            return Number.isFinite(bounds.max) && bounds.max >= bounds.min
        }) &&
        entities.some((entity) => getScaleBounds(entity, axis).max > pivot)
    )
}

export const isWithinGridBudget = (source: State, values: Map<EditableEntity, number>) => {
    const spans = new Map<
        string,
        { beforeMin: number; beforeMax: number; afterMin: number; afterMax: number }
    >()
    const include = (key: string, entity: EditableEntity) => {
        const value = values.get(entity) ?? entity.beat
        const span = spans.get(key)
        if (span) {
            span.beforeMin = Math.min(span.beforeMin, entity.beat)
            span.beforeMax = Math.max(span.beforeMax, entity.beat)
            span.afterMin = Math.min(span.afterMin, value)
            span.afterMax = Math.max(span.afterMax, value)
        } else {
            spans.set(key, {
                beforeMin: entity.beat,
                beforeMax: entity.beat,
                afterMin: value,
                afterMax: value,
            })
        }
    }
    const slides = new Set(
        [...values.keys()]
            .filter((entity) => entity.type === 'note')
            .map((entity) => entity.slideId),
    )
    for (const id of slides) {
        for (const entity of source.store.slides.note.get(id) ?? []) include(`note:${id}`, entity)
    }
    const eventTypes = new Set(
        [...values.keys()]
            .filter(
                (entity) =>
                    entity.type !== 'note' && entity.type !== 'bpm' && entity.type !== 'timeScale',
            )
            .map((entity) => entity.type),
    )
    for (const type of eventTypes) {
        for (const bucket of source.store.grid[type].values()) {
            for (const entity of bucket) {
                if (!isEditableEntity(entity)) continue
                include(`${type}:${'stageId' in entity ? entity.stageId : ''}`, entity)
            }
        }
    }
    let expansion = 0
    for (const span of spans.values()) {
        const before = Math.floor(span.beforeMax) - Math.floor(span.beforeMin)
        const after = Math.floor(span.afterMax) - Math.floor(span.afterMin)
        expansion += Math.max(0, after - before)
        if (expansion > 1_000_000) return false
    }
    return true
}

/** Whether objects can move to these beats; Scale Selection refuses results past this. */
export const isWithinBeatRange = (source: State, values: Map<EditableEntity, number>) =>
    [...values.values()].every((beat) => Number.isSafeInteger(Math.floor(beat))) &&
    isWithinGridBudget(source, values)

export const getScaledSelectionValues = (
    selected: Entity[],
    axis: ScaleAxis,
    factor: number,
    source?: State,
    anchor?: number,
): Map<EditableEntity, number> | undefined => {
    if (
        !Number.isFinite(factor) ||
        factor <= 0 ||
        factor === 1 ||
        !canScaleSelection(selected, axis, source)
    )
        return
    const entities = getScaleEntities(selected, axis, source)
    const pivot = anchor ?? getScalePivot(entities, axis, source)
    if (pivot === undefined || !Number.isFinite(pivot)) return
    const values = transformValues(
        entities,
        axis,
        (value) => pivot + (value - pivot) * factor,
        source,
    )
    if (axis === 'width' && values && !validWidthValues(values, factor)) return
    return values
}

const validWidthValues = (values: Map<EditableEntity, number>, factor: number) => {
    for (const [entity, left] of values) {
        const sizeKey = widthKeys(entity)?.[1]
        const originalSize = sizeKey ? Number((entity as EditableProperties)[sizeKey]) : 0
        const size = originalSize * factor
        if (
            !Number.isFinite(size) ||
            size < 0 ||
            !Number.isFinite(left + size) ||
            (originalSize > 0 && !(left + size > left)) ||
            (entity.type === 'cameraEventJoint' && (size < 6 || size > 24))
        )
            return false
    }
    return true
}

export const getTranslatedSelectionValues = (
    selected: Entity[],
    axis: ScaleAxis,
    delta: number,
    source?: State,
): Map<EditableEntity, number> | undefined => {
    if (!Number.isFinite(delta) || delta === 0) return
    const values = transformValues(
        getScaleEntities(selected, axis, source),
        axis,
        (value) => value + delta,
        source,
    )
    if (axis === 'width' && values && !validWidthValues(values, 1)) return
    return values
}

const transformValues = (
    entities: EditableEntity[],
    axis: ScaleAxis,
    transform: (value: number) => number,
    source?: State,
) => {
    const values = new Map<EditableEntity, number>()
    let previousValue: number | undefined
    let previousTransformed: number | undefined
    for (const entity of [...entities].sort(
        (a, b) => getScaleValue(a, axis) - getScaleValue(b, axis),
    )) {
        const value = getScaleValue(entity, axis)
        const transformed = transform(value)
        if (
            !Number.isFinite(transformed) ||
            (axis === 'beat' &&
                ((transformed < 0 && value >= 0) || !Number.isSafeInteger(Math.floor(transformed))))
        )
            return
        if (
            previousValue !== undefined &&
            value > previousValue &&
            previousTransformed !== undefined &&
            transformed <= previousTransformed
        )
            return
        values.set(entity, transformed)
        previousValue = value
        previousTransformed = transformed
    }
    if (axis === 'beat' && source && !isWithinGridBudget(source, values)) return
    return new Map(
        entities.map((entity) => [entity, values.get(entity) ?? getScaleValue(entity, axis)]),
    )
}
