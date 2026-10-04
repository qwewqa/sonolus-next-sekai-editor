import { shallowRef, watch, type WatchStopHandle } from 'vue'
import { pushState, state } from '../../../history'
import { i18n } from '../../../i18n'
import {
    clearPreviewEdit,
    getPreviewState,
    previewEdit,
    setPreviewEdit,
    type PreviewEdit,
} from '../../../preview/edit'
import type { State } from '../../../state'
import { hasSameChartData } from '../../../state/data'
import type { Entity } from '../../../state/entities'
import type { NoteEntity } from '../../../state/entities/slides/note'
import { scaleSelection } from '../../../state/operations/scaleSelection'
import {
    canScaleSelection,
    getScaleEntities,
    getScalePivot,
    getScaledSelectionValues,
    type ScaleAxis,
} from '../../../state/operations/scaleValues'
import { interpolate } from '../../../utils/interpolate'
import { notify } from '../../notification'
import { toolName } from '../../tools/state'
import { view } from '../../view'

export type ScalingSession = {
    id: number
    source: State
    selected: Entity[]
    axis: ScaleAxis
    pivot: number
    factor: number
    requestedFactor: number
    valid: boolean
}

export const scalingSession = shallowRef<ScalingSession>()
let nextId = 0
let ownedEdit: PreviewEdit | undefined
let ownerToken: symbol | undefined
let stopWatching: WatchStopHandle[] = []
let drag:
    | { id: number; value: number; distance: number; factor: number; requestedFactor: number }
    | undefined
let mappedState: State | undefined
let baselineByDraft = new Map<NoteEntity, NoteEntity>()
let baselineNotes: NoteEntity[] = []
let baselineNoteSet = new Set<NoteEntity>()
let eligibleNotes = new Set<NoteEntity>()

const sourceIsCurrent = (session: ScalingSession) => {
    const current = state.value
    if (current === session.source) return true
    return (
        hasSameChartData(session.source, current) &&
        current.bgm === session.source.bgm &&
        current.initialLife === session.source.initialLife &&
        current.selectedEntities.length === session.selected.length &&
        current.selectedEntities.every((entity, index) => entity === session.selected[index])
    )
}

export const cancelScalingSession = () => {
    scalingSession.value = undefined
    drag = undefined
    for (const stop of stopWatching) stop()
    stopWatching = []
    if (ownedEdit && previewEdit.value === ownedEdit) clearPreviewEdit()
    ownedEdit = undefined
    ownerToken = undefined
    mappedState = undefined
    baselineByDraft.clear()
    baselineNotes = []
    baselineNoteSet.clear()
    eligibleNotes.clear()
    view.entities = { hovered: [], creating: [] }
}

export const beginScalingSession = (axis: ScaleAxis) => {
    cancelScalingSession()
    const source = state.value
    const selected = [...source.selectedEntities]
    if (!canScaleSelection(selected, axis, source)) return
    const pivot = getScalePivot(selected, axis, source)
    if (pivot === undefined) return
    clearPreviewEdit()
    ownerToken = Symbol('scaling')
    baselineNotes = selected.filter((entity) => entity.type === 'note')
    baselineNoteSet = new Set(baselineNotes)
    eligibleNotes = new Set(
        getScaleEntities(selected, axis, source).filter((entity) => entity.type === 'note'),
    )
    const session: ScalingSession = {
        id: ++nextId,
        source,
        selected,
        axis,
        pivot,
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
                const current = scalingSession.value
                if (
                    current &&
                    ((edit && edit.dependencies?.[0] !== ownerToken) ||
                        (!edit && current.factor !== 1))
                ) {
                    cancelScalingSession()
                }
            },
            { flush: 'sync' },
        ),
    ]
    return session
}

const updateFactor = (value: number, allowInvalid: boolean) => {
    const session = scalingSession.value
    if (!session || !sourceIsCurrent(session)) {
        if (session) cancelScalingSession()
        return false
    }
    if (Object.is(session.requestedFactor, value)) return session.valid
    const valid =
        Number.isFinite(value) &&
        value > 0 &&
        (value === 1 ||
            getScaledSelectionValues(session.selected, session.axis, value, session.source) !==
                undefined)
    if (!valid && !allowInvalid) return false
    scalingSession.value = {
        ...session,
        requestedFactor: value,
        valid,
        factor: valid ? value : session.factor,
    }
    if (!valid) return false
    if (value === 1) {
        if (ownedEdit && previewEdit.value === ownedEdit) clearPreviewEdit()
        ownedEdit = undefined
    } else {
        setPreviewEdit(
            session.source,
            () => scaleSelection(session.source, session.selected, session.axis, value),
            [ownerToken, value],
        )
        ownedEdit = previewEdit.value
    }
    mappedState = undefined
    return true
}

export const setScalingFactor = (value: number) => updateFactor(value, true)

export const applyScalingSession = () => {
    const session = scalingSession.value
    if (!session?.valid) return false
    if (!sourceIsCurrent(session)) {
        cancelScalingSession()
        return false
    }
    const result = session.factor === 1 ? session.source : getPreviewState(state.value, ownedEdit)
    const filename = state.value.filename
    const labels = () =>
        session.axis === 'beat' ? i18n.value.commands.scaleBeat : i18n.value.commands.scaleElevation
    const message = interpolate(
        () => labels().scaled,
        `${getScaleEntities(session.selected, session.axis, session.source).length}`,
    )
    cancelScalingSession()
    if (result === session.source) return true
    pushState(message, { ...result, filename })
    notify(message)
    return true
}

export const getScalingBaselineNote = (note: NoteEntity) => {
    const session = scalingSession.value
    if (!session) return
    if (baselineNoteSet.has(note)) return note
    const draft = getPreviewState(state.value, ownedEdit)
    if (draft !== mappedState) {
        mappedState = draft
        const draftNotes = draft.selectedEntities.filter((entity) => entity.type === 'note')
        baselineByDraft = new Map(
            draftNotes.flatMap((entity, index) => {
                const baseline = baselineNotes[index]
                return baseline ? [[entity, baseline] as const] : []
            }),
        )
    }
    return baselineByDraft.get(note)
}

export const beginScalingDrag = (note: NoteEntity, value: number) => {
    const session = scalingSession.value
    const baseline = getScalingBaselineNote(note)
    if (!session || !baseline || !Number.isFinite(value) || !eligibleNotes.has(baseline))
        return false
    const distance = (session.axis === 'beat' ? baseline.beat : baseline.elevation) - session.pivot
    if (!(distance > 0) || !Number.isFinite(distance)) return false
    drag = {
        id: session.id,
        value,
        distance,
        factor: session.factor,
        requestedFactor: session.requestedFactor,
    }
    if (!session.valid) setScalingFactor(session.factor)
    return true
}

export const updateScalingDrag = (value: number) => {
    const active = drag
    if (!active || active.id !== scalingSession.value?.id || !Number.isFinite(value)) return false
    return updateFactor(active.factor + (value - active.value) / active.distance, false)
}

export const endScalingDrag = () => {
    drag = undefined
}
export const cancelScalingDrag = () => {
    const active = drag
    drag = undefined
    if (active && active.id === scalingSession.value?.id) {
        setScalingFactor(active.factor)
        if (!Object.is(active.requestedFactor, active.factor))
            setScalingFactor(active.requestedFactor)
    }
}
