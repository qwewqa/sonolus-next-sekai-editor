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
    getScaledSelectionValues,
    getTranslatedSelectionValues,
    type ScaleAxis,
} from '../../../state/operations/scaleValues'
import { translateSelection } from '../../../state/operations/translateSelection'
import { interpolate } from '../../../utils/interpolate'
import { notify } from '../../notification'
import { toolName } from '../../tools/state'
import { view } from '../../view'

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
    id: number
    source: State
    value: number
    noteValue: number
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
let baselineByDraft = new Map<NoteEntity, NoteEntity>()
let draftByBaseline = new Map<NoteEntity, NoteEntity>()
let baselineNotes: NoteEntity[] = []
let baselineNoteSet = new Set<NoteEntity>()

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
const axisValue = (note: NoteEntity, axis: ScaleAxis) =>
    axis === 'beat' ? note.beat : note.elevation
const extrema = (source: State, axis: ScaleAxis) => {
    let min = Infinity
    let max = -Infinity
    for (const entity of getScaleEntities(source.selectedEntities, axis, source)) {
        const value = axis === 'beat' ? entity.beat : 'elevation' in entity ? entity.elevation : NaN
        min = Math.min(min, value)
        max = Math.max(max, value)
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
    baselineNotes = []
    baselineNoteSet.clear()
    view.entities = { hovered: [], creating: [] }
}

export const beginScalingSession = (axis: ScaleAxis) => {
    cancelScalingSession()
    const source = state.value
    const selected = [...source.selectedEntities]
    if (!canScaleSelection(selected, axis, source)) return
    clearPreviewEdit()
    ownerToken = Symbol('scaling')
    baselineNotes = selected.filter((entity) => entity.type === 'note')
    baselineNoteSet = new Set(baselineNotes)
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
    const labels = () =>
        session.axis === 'beat' ? i18n.value.commands.scaleBeat : i18n.value.commands.scaleElevation
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

const mapDraftNotes = (draft: State) => {
    if (draft === mappedState) return
    mappedState = draft
    const notes = draft.selectedEntities.filter((entity) => entity.type === 'note')
    baselineByDraft = new Map()
    draftByBaseline = new Map()
    for (const [index, note] of notes.entries()) {
        const baseline = baselineNotes[index]
        if (!baseline) continue
        baselineByDraft.set(note, baseline)
        draftByBaseline.set(baseline, note)
    }
}
export const getScalingBaselineNote = (note: NoteEntity) => {
    if (!scalingSession.value) return
    if (baselineNoteSet.has(note)) return note
    mapDraftNotes(draftState())
    return baselineByDraft.get(note)
}

export const beginScalingDrag = (note: NoteEntity, value: number) => {
    const session = scalingSession.value
    const baseline = getScalingBaselineNote(note)
    if (!session || !baseline || !Number.isFinite(value)) return false
    const source = draftState()
    mapDraftNotes(source)
    const currentNote = draftByBaseline.get(baseline)
    if (!currentNote) return false
    const eligible = getScaleEntities(source.selectedEntities, session.axis, source).includes(
        currentNote,
    )
    const { min, max } = extrema(source, session.axis)
    const noteValue = axisValue(currentNote, session.axis)
    if (!(max > min) || !Number.isFinite(noteValue)) return false
    const endpoint = eligible && (noteValue === min || noteValue === max)
    drag = {
        id: session.id,
        source,
        value,
        noteValue,
        anchor: noteValue === min ? max : min,
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
    if (active.lastValue === value) return true
    const delta = value - active.value
    const source = active.source
    const selected = source.selectedEntities
    const axis = session.axis
    if (active.endpoint) {
        const anchor = active.anchor
        const ratio =
            (active.noteValue + delta - active.anchor) / (active.noteValue - active.anchor)
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
        anchorSide = active.noteValue < active.anchor ? 'max' : 'min'
        active.lastValue = value
        return publishDraft(
            () => (ratio === 1 ? source : scaleSelection(source, selected, axis, ratio, anchor)),
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
    active.lastValue = value
    return publishDraft(
        () => (delta === 0 ? source : translateSelection(source, selected, axis, delta)),
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
