import { shallowRef, watch, type WatchStopHandle } from 'vue'
import { pushState, state } from '../../../history'
import {
    clearPreviewEdit,
    getPreviewState,
    previewEdit,
    setPreviewEdit,
    type PreviewEdit,
} from '../../../preview/edit'
import { settings } from '../../../settings'
import type { State } from '../../../state'
import { hasSameChartData } from '../../../state/data'
import type { Entity } from '../../../state/entities'
import { isEditableEntity, type EditableEntity } from '../../../state/operations/editable'
import { getMaterializedNotePositions } from '../../../state/operations/notePositions'
import { scaleSelection } from '../../../state/operations/scaleSelection'
import {
    canScaleSelection,
    getScaleBounds,
    getScaleEntities,
    getScaleValue,
    getScaledSelectionValues,
    getTranslatedSelectionValues,
    type ScaleAxis,
} from '../../../state/operations/scaleValues'
import { transformSelection } from '../../../state/operations/transformSelection'
import { translateSelection } from '../../../state/operations/translateSelection'
import { interpolate } from '../../../utils/interpolate'
import { clamp } from '../../../utils/math'
import { constrainLaneObject } from '../../laneLimits'
import { notify } from '../../notification'
import { toolName } from '../../tools/state'
import { view } from '../../view'
import { getScaleLabels } from './labels'

export type ScalingSession = {
    id: number
    source: State
    selected: Entity[]
    axis: ScaleAxis
    factor: number
    requestedFactor: number
    valid: boolean
}

type ScalingDrag = {
    baseline: EditableEntity
    bounds: { min: number; max: number }
    attached: boolean
    id: number
    source: State
    value: number
    entityValue: number
    anchor: number
    endpoint: boolean
    factor: number
    requestedFactor: number
    valid: boolean
    anchorSide: 'min' | 'max'
    edit: PreviewEdit | undefined
    lastValue?: number
}

export const scalingSession = shallowRef<ScalingSession>()
let nextId = 0
let ownedEdit: PreviewEdit | undefined
let ownerToken: symbol | undefined
let revision = 0
let publishing = false
let stopWatching: WatchStopHandle[] = []
let drag: ScalingDrag | undefined
let numericBase: State | undefined
let numericBaseFactor = 1
let anchorSide: 'min' | 'max' = 'min'
let mappedState: State | undefined
let baselineByDraft = new Map<EditableEntity, EditableEntity>()
let draftByBaseline = new Map<EditableEntity, EditableEntity>()
let baselineEntities: EditableEntity[] = []
let baselineEntitySet = new Set<EditableEntity>()

const sourceIsCurrent = (session: ScalingSession) => {
    const current = state.value
    return (
        current === session.source ||
        (hasSameChartData(session.source, current) &&
            current.bgm === session.source.bgm &&
            current.initialLife === session.source.initialLife &&
            current.selectedEntities.length === session.selected.length &&
            current.selectedEntities.every((entity, index) => entity === session.selected[index]))
    )
}
const draftState = () => (ownedEdit ? getPreviewState(state.value, ownedEdit) : state.value)
const extrema = (source: State, axis: ScaleAxis) => {
    let min = Infinity
    let max = -Infinity
    for (const entity of getScaleEntities(source.selectedEntities, axis, source)) {
        const bounds = getScaleBounds(entity, axis)
        min = Math.min(min, bounds.min)
        max = Math.max(max, bounds.max)
    }
    return { min, max }
}
const invalidateMapping = () => {
    mappedState = undefined
}
const publishDraft = (build: () => State, factor: number) => {
    const session = scalingSession.value
    if (!session || !Number.isFinite(factor) || factor <= 0) return false
    publishing = true
    try {
        scalingSession.value = { ...session, factor, requestedFactor: factor, valid: true }
        setPreviewEdit(session.source, build, [ownerToken, ++revision])
        ownedEdit = previewEdit.value
        invalidateMapping()
    } finally {
        publishing = false
    }
    return true
}

export const cancelScalingSession = () => {
    scalingSession.value = undefined
    drag = undefined
    for (const stop of stopWatching) stop()
    stopWatching = []
    if (ownedEdit && previewEdit.value === ownedEdit) clearPreviewEdit()
    ownedEdit = undefined
    ownerToken = undefined
    numericBase = undefined
    mappedState = undefined
    baselineByDraft.clear()
    draftByBaseline.clear()
    baselineEntities = []
    baselineEntitySet.clear()
    view.entities = { hovered: [], creating: [] }
}

export const beginScalingSession = (axis: ScaleAxis) => {
    cancelScalingSession()
    const source = state.value
    const selected = [...source.selectedEntities]
    if (!canScaleSelection(selected, axis, source)) return
    clearPreviewEdit()
    ownerToken = Symbol('scaling')
    baselineEntities = selected.filter(isEditableEntity)
    baselineEntitySet = new Set(baselineEntities)
    numericBase = source
    numericBaseFactor = 1
    anchorSide = 'min'
    const session: ScalingSession = {
        id: ++nextId,
        source,
        selected,
        axis,
        factor: 1,
        requestedFactor: 1,
        valid: true,
    }
    scalingSession.value = session
    stopWatching = [
        watch(
            state,
            () => {
                const current = scalingSession.value
                if (current && !sourceIsCurrent(current)) cancelScalingSession()
            },
            { flush: 'sync' },
        ),
        watch(
            toolName,
            () => {
                cancelScalingSession()
            },
            { flush: 'sync' },
        ),
        watch(
            previewEdit,
            (edit) => {
                if (publishing || !scalingSession.value) return
                if ((edit && edit.dependencies?.[0] !== ownerToken) || (!edit && ownedEdit))
                    cancelScalingSession()
            },
            { flush: 'sync' },
        ),
    ]
    return session
}

export const setScalingFactor = (value: number) => {
    const session = scalingSession.value
    const base = numericBase
    if (!session || !base || !sourceIsCurrent(session)) {
        if (session) cancelScalingSession()
        return false
    }
    if (Object.is(session.requestedFactor, value)) return session.valid
    const range = extrema(base, session.axis)
    const pivot = anchorSide === 'min' ? range.min : range.max
    const ratio = value / numericBaseFactor
    const valid =
        Number.isFinite(value) &&
        value > 0 &&
        Number.isFinite(ratio) &&
        ratio > 0 &&
        (ratio === 1 ||
            getScaledSelectionValues(base.selectedEntities, session.axis, ratio, base, pivot) !==
                undefined)
    if (!valid) {
        scalingSession.value = { ...session, requestedFactor: value, valid: false }
        return false
    }
    const axis = session.axis
    const selected = base.selectedEntities
    return publishDraft(
        () => (ratio === 1 ? base : scaleSelection(base, selected, axis, ratio, pivot)),
        value,
    )
}

export const applyScalingSession = () => {
    const session = scalingSession.value
    if (!session?.valid) return false
    if (!sourceIsCurrent(session)) {
        cancelScalingSession()
        return false
    }
    const result = draftState()
    const filename = state.value.filename
    const labels = () => getScaleLabels(session.axis)
    const message = interpolate(
        () => labels().scaled,
        String(getScaleEntities(session.selected, session.axis, session.source).length),
    )
    cancelScalingSession()
    if (result === session.source) return true
    pushState(message, { ...result, filename })
    notify(message)
    return true
}

const mapDraftEntities = (draft: State) => {
    if (draft === mappedState) return
    mappedState = draft
    const entities = draft.selectedEntities.filter(isEditableEntity)
    baselineByDraft = new Map()
    draftByBaseline = new Map()
    const byType = new Map<EditableEntity['type'], EditableEntity[]>()
    for (const entity of entities) {
        const bucket = byType.get(entity.type)
        if (bucket) bucket.push(entity)
        else byType.set(entity.type, [entity])
    }
    const offsets = new Map<EditableEntity['type'], number>()
    for (const baseline of baselineEntities) {
        const offset = offsets.get(baseline.type) ?? 0
        const entity = byType.get(baseline.type)?.[offset]
        offsets.set(baseline.type, offset + 1)
        if (!entity) continue
        baselineByDraft.set(entity, baseline)
        draftByBaseline.set(baseline, entity)
    }
}
export const getScalingBaselineEntity = (entity: EditableEntity) => {
    if (!scalingSession.value) return
    if (baselineEntitySet.has(entity)) return entity
    mapDraftEntities(draftState())
    return baselineByDraft.get(entity)
}

// beginScalingDrag rejects every entity without this.
export const hasScalingRange = () => {
    const session = scalingSession.value
    if (!session) return false
    const { min, max } = extrema(draftState(), session.axis)
    return max > min
}

export const beginScalingDrag = (entity: EditableEntity, value: number, edge?: 'min' | 'max') => {
    const session = scalingSession.value
    const baseline = getScalingBaselineEntity(entity)
    if (!session || !baseline || !Number.isFinite(value)) return false
    const source = draftState()
    mapDraftEntities(source)
    const currentEntity = draftByBaseline.get(baseline)
    if (!currentEntity) return false
    const eligible = getScaleEntities(source.selectedEntities, session.axis, source).includes(
        currentEntity,
    )
    const { min, max } = extrema(source, session.axis)
    const bounds = getScaleBounds(currentEntity, session.axis)
    const materialized =
        settings.maxLane > 0 && session.axis === 'width' && currentEntity.type === 'note'
            ? getMaterializedNotePositions(source, [currentEntity]).get(currentEntity)
            : undefined
    const entityValue =
        session.axis === 'width' && edge ? bounds[edge] : getScaleValue(currentEntity, session.axis)
    if (!(max > min) || !Number.isFinite(entityValue)) return false
    const anchor =
        session.axis === 'width' ? (edge === 'min' ? max : min) : entityValue === min ? max : min
    const endpoint =
        eligible &&
        (session.axis === 'width'
            ? edge !== undefined && entityValue !== anchor
            : entityValue === min || entityValue === max)
    drag = {
        baseline,
        bounds: materialized
            ? { min: materialized.left, max: materialized.left + materialized.size }
            : getScaleBounds(currentEntity, 'width'),
        attached: materialized !== undefined,
        id: session.id,
        source,
        value,
        entityValue,
        anchor,
        endpoint,
        factor: session.factor,
        requestedFactor: session.requestedFactor,
        valid: session.valid,
        anchorSide,
        edit: ownedEdit,
    }
    if (!session.valid)
        scalingSession.value = { ...session, valid: true, requestedFactor: session.factor }
    return true
}

export const updateScalingDrag = (value: number) => {
    const session = scalingSession.value
    const active = drag
    if (
        !session ||
        active?.id !== session.id ||
        !Number.isFinite(value) ||
        !sourceIsCurrent(session)
    )
        return false
    let delta = value - active.value
    if (delta === 0 && active.lastValue === undefined) return true
    const source = active.source
    const selected = source.selectedEntities
    const axis = session.axis
    if (axis === 'width' && settings.maxLane > 0) {
        if (active.endpoint) {
            delta =
                clamp(active.entityValue + delta, -settings.maxLane, settings.maxLane) -
                active.entityValue
        } else if (active.attached) {
            const constrained = constrainLaneObject({
                left: active.bounds.min + delta,
                size: active.bounds.max - active.bounds.min,
            })
            delta = constrained.left - active.bounds.min
        }
    }
    const effectiveValue = active.value + delta
    if (active.lastValue === effectiveValue) return true
    const constrainDraft = (result: State) => {
        if (!(settings.maxLane > 0) || active.attached) return result
        mapDraftEntities(result)
        const focus = draftByBaseline.get(active.baseline)
        if (!focus) return result
        const constrained = constrainLaneObject(focus, {
            resizing: axis === 'width' && active.endpoint,
        })
        return constrained === focus
            ? result
            : transformSelection(result, result.selectedEntities, new Map([[focus, constrained]]))
    }
    if (active.endpoint) {
        const anchor = active.anchor
        const ratio =
            (active.entityValue + delta - active.anchor) / (active.entityValue - active.anchor)
        const factor = active.factor * ratio
        if (
            !Number.isFinite(ratio) ||
            ratio <= 0 ||
            !Number.isFinite(factor) ||
            factor <= 0 ||
            (ratio !== 1 &&
                !getScaledSelectionValues(
                    active.source.selectedEntities,
                    session.axis,
                    ratio,
                    active.source,
                    active.anchor,
                ))
        )
            return false
        anchorSide = active.entityValue < active.anchor ? 'max' : 'min'
        active.lastValue = effectiveValue
        return publishDraft(
            () =>
                constrainDraft(
                    ratio === 1 ? source : scaleSelection(source, selected, axis, ratio, anchor),
                ),
            factor,
        )
    }
    if (
        delta !== 0 &&
        !getTranslatedSelectionValues(
            active.source.selectedEntities,
            session.axis,
            delta,
            active.source,
        )
    )
        return false
    active.lastValue = effectiveValue
    return publishDraft(
        () =>
            constrainDraft(
                delta === 0 ? source : translateSelection(source, selected, axis, delta),
            ),
        active.factor,
    )
}

export const endScalingDrag = () => {
    if (!drag || drag.id !== scalingSession.value?.id) {
        drag = undefined
        return
    }
    numericBase = draftState()
    numericBaseFactor = scalingSession.value.factor
    drag = undefined
}
export const cancelScalingDrag = () => {
    const active = drag
    const session = scalingSession.value
    drag = undefined
    if (!session || active?.id !== session.id) return
    publishing = true
    try {
        scalingSession.value = {
            ...session,
            factor: active.factor,
            requestedFactor: active.requestedFactor,
            valid: active.valid,
        }
        previewEdit.value = active.edit
        ownedEdit = active.edit
        anchorSide = active.anchorSide
        invalidateMapping()
    } finally {
        publishing = false
    }
}
