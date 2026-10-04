import type { State } from '..'
import type { Entity } from '../entities'
import { isEditableEntity, type EditableEntity } from './editable'

export type ScaleAxis = 'beat' | 'elevation'

export const getScaleEntities = (selected: Entity[], axis: ScaleAxis, source?: State) =>
    [...new Set(selected.filter(isEditableEntity))].filter((entity) => {
        if (axis === 'beat') return true
        if (entity.type === 'stageTransformEventJoint') return true
        if (entity.type !== 'note') return false
        if (!entity.isAttached) return true
        const slide = source?.store.slides.note.get(entity.slideId)
        return slide?.[0] === entity || slide?.at(-1) === entity
    })

const valueOf = (entity: EditableEntity, axis: ScaleAxis) =>
    axis === 'beat' ? entity.beat : 'elevation' in entity ? entity.elevation : NaN

export const getScalePivot = (selected: Entity[], axis: ScaleAxis, source?: State) => {
    let pivot = Infinity
    for (const entity of getScaleEntities(selected, axis, source)) {
        const value = valueOf(entity, axis)
        if (!Number.isFinite(value)) return undefined
        pivot = Math.min(pivot, value)
    }
    return Number.isFinite(pivot) ? pivot : undefined
}

export const canScaleSelection = (selected: Entity[], axis: ScaleAxis, source?: State) => {
    const entities = getScaleEntities(selected, axis, source)
    const pivot = getScalePivot(entities, axis, source)
    return (
        entities.length >= 2 &&
        pivot !== undefined &&
        entities.some((entity) => valueOf(entity, axis) > pivot)
    )
}

const withinGridBudget = (source: State, values: Map<EditableEntity, number>) => {
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

export const getScaledSelectionValues = (
    selected: Entity[],
    axis: ScaleAxis,
    factor: number,
    source?: State,
): Map<EditableEntity, number> | undefined => {
    if (
        !Number.isFinite(factor) ||
        factor <= 0 ||
        factor === 1 ||
        !canScaleSelection(selected, axis, source)
    )
        return
    const entities = getScaleEntities(selected, axis, source)
    const pivot = getScalePivot(entities, axis, source)
    if (pivot === undefined) return
    const values = new Map<EditableEntity, number>()
    let previousValue: number | undefined
    let previousScaled: number | undefined
    for (const entity of [...entities].sort((a, b) => valueOf(a, axis) - valueOf(b, axis))) {
        const value = valueOf(entity, axis)
        const scaled = pivot + (value - pivot) * factor
        if (
            !Number.isFinite(scaled) ||
            (axis === 'beat' && !Number.isSafeInteger(Math.floor(scaled)))
        )
            return
        if (
            previousValue !== undefined &&
            value > previousValue &&
            previousScaled !== undefined &&
            scaled <= previousScaled
        )
            return
        values.set(entity, scaled)
        previousValue = value
        previousScaled = scaled
    }
    if (axis === 'beat' && source && !withinGridBudget(source, values)) return
    return new Map(entities.map((entity) => [entity, values.get(entity) ?? valueOf(entity, axis)]))
}
