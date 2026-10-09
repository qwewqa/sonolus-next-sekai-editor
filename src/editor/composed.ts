import type { StageId } from '../chart/stages'
import { easeValues } from '../ease'
import {
    ease,
    eventProgress,
    lerp,
    unlerpClamped,
    type EaseTypeValue,
    type LimitOptions,
} from '../preview/engine/math'
import type { PreviewStage } from '../preview/engine/model'
import { getStageProps, type StageProps } from '../preview/engine/stage'
import type { State } from '../state'
import type { Entity, EntityHitbox } from '../state/entities'
import { sameBeatAttachmentFraction } from '../state/entities/slides/attachment'
import type { ConnectorEntity } from '../state/entities/slides/connector'
import type { SlideInfos } from '../state/entities/slides/hiddenTicks'
import type { NoteEntity } from '../state/entities/slides/note'
import { beatToTime, timeToBeat } from '../state/integrals/bpms'

export type ComposedPosition = { left: number; size: number }
export type ComposedOptions = LimitOptions & { slideInfos?: readonly SlideInfos[number][] }
export type ComposedStage = {
    startBeat: number
    endBeat: number
    breakpoints: number[]
    props: PreviewStage
}

const colors = ['neutral', 'red', 'green', 'blue', 'yellow', 'purple', 'cyan', 'black']
const borders = ['default', 'light', 'disabled', 'medium']
type LayoutRecord = { source: State; layout: ComposedLayout }
const layouts = new WeakMap<State, LayoutRecord>()
let lastLayout: WeakRef<LayoutRecord> | undefined
let stageCache: { dependencies: unknown[]; stages: Map<StageId, ComposedStage> } | undefined
const unique = <T>(grid: Map<number, Set<T>>) => [
    ...new Set([...grid.values()].flatMap((set) => [...set])),
]

// Engine division sets start at parity * size / 2. Authoring subdivisions use
// integer division counts, so only the fractional part changes their lattice.
const divisionPhase = ({ size, parity }: { size: number; parity: number }) =>
    size > 0 && parity === 1 && Math.trunc(size) % 2 !== 0 ? 0.5 : 0

/** Edge-grid phase of the dominant divider set; equal weights select the new set. */
export const divisionGridOffset = (division: StageProps['division']) =>
    divisionPhase(division.progress >= 0.5 ? division.end : division.start)

const gridCrossingCache = new Map<EaseTypeValue, readonly number[]>()

// All native eases are fixed curves. In particular Out-In Elastic crosses the
// halfway weight fifteen times; a single midpoint split cannot follow its grid.
const gridCrossings = (type: EaseTypeValue) => {
    const cached = gridCrossingCache.get(type)
    if (cached) return cached
    const crossings: number[] = []
    const bins = 256
    let previous = ease(type, 0) >= 0.5
    for (let index = 1; index <= bins; index++) {
        const current = ease(type, index / bins) >= 0.5
        if (current !== previous) {
            let left = (index - 1) / bins
            let right = index / bins
            for (let iteration = 0; iteration < 52; iteration++) {
                const middle = (left + right) / 2
                if (middle === left || middle === right) break
                if (ease(type, middle) >= 0.5 === previous) left = middle
                else right = middle
            }
            if (right > 0 && right < 1) crossings.push(right)
        }
        previous = current
    }
    gridCrossingCache.set(type, crossings)
    return crossings
}

/** Horizontal geometry of the engine's beat-versus-lane Preview mode. */
const buildComposedLayout = (state: State) => {
    const toTime = (beat: number) => {
        const first = state.bpms[0]
        return first && beat < first.x
            ? first.y + (beat - first.x) * first.s
            : beatToTime(state.bpms, beat)
    }
    // Note edits and selection changes preserve stage grids and tempo maps.
    // Avoid rebuilding every stage for each pointer-move snapshot.
    const dependencies = [
        state.isDynamicStages,
        state.bpms,
        state.stages,
        state.store.grid.stageMaskEventJoint,
        state.store.grid.stagePivotEventJoint,
        state.store.grid.stageStyleEventJoint,
        state.store.grid.stageTransformEventJoint,
    ]
    const cachedStages = stageCache?.dependencies.every((value, i) => value === dependencies[i])
        ? stageCache.stages
        : undefined
    const stages = cachedStages ?? new Map<StageId, ComposedStage>()
    if (!cachedStages && state.isDynamicStages) {
        const masks = unique(state.store.grid.stageMaskEventJoint)
        const pivots = unique(state.store.grid.stagePivotEventJoint)
        const styles = unique(state.store.grid.stageStyleEventJoint)
        const transforms = unique(state.store.grid.stageTransformEventJoint)
        for (const [stageId, stage] of state.stages) {
            const stageEvents = <T extends { stageId: StageId; beat: number }>(events: T[]) =>
                events.filter((event) => event.stageId === stageId).sort((a, b) => a.beat - b.beat)
            const stageMasks = stageEvents(masks)
            const stagePivots = stageEvents(pivots)
            const stageStyles = stageEvents(styles)
            const stageTransforms = stageEvents(transforms)
            const startBeat = stage.isFromStart ? -Infinity : (stageMasks[0]?.beat ?? Infinity)
            const endBeat = stage.isUntilEnd ? Infinity : (stageMasks.at(-1)?.beat ?? -Infinity)
            const props: PreviewStage = {
                order: stages.size,
                drawStartTime: Number.isFinite(startBeat) ? toTime(startBeat) : startBeat,
                drawEndTime: Number.isFinite(endBeat) ? toTime(endBeat) : endBeat,
                masks: stageMasks.map((event) => ({
                    time: toTime(event.beat),
                    lane: event.maskLeft + event.maskSize / 2,
                    size: event.maskSize / 2,
                    maskNotes: event.isMaskNotes,
                    ease: easeValues[event.eventEase] as EaseTypeValue,
                })),
                pivots: stagePivots.map((event) => ({
                    time: toTime(event.beat),
                    lane: event.pivotLane,
                    divisionSize: event.divisionSize,
                    divisionParity: event.divisionParity === 'odd' ? 1 : 0,
                    // Vertical playfield properties do not affect Preview composition.
                    yOffset: 0,
                    ease: easeValues[event.eventEase] as EaseTypeValue,
                })),
                styles: stageStyles.map((event) => ({
                    time: toTime(event.beat),
                    judgeLineColor: colors.indexOf(event.judgmentLineColor),
                    judgeLineStyle: event.judgmentLineStyle === 'singleLine' ? 1 : 0,
                    leftBorderStyle: borders.indexOf(event.leftBorderStyle),
                    rightBorderStyle: borders.indexOf(event.rightBorderStyle),
                    fullWidth: event.isFullWidth ? 1 : 0,
                    noteAlpha: event.noteAlpha,
                    laneAlpha: event.laneAlpha,
                    judgeLineAlpha: event.judgmentLineAlpha,
                    divisionLineAlpha: event.divisionLineAlpha,
                    ease: easeValues[event.eventEase] as EaseTypeValue,
                })),
                transforms: stageTransforms.map((event) => ({
                    time: toTime(event.beat),
                    rotate: 0,
                    xLaneTranslate: event.xTranslation,
                    yLaneTranslate: 0,
                    elevation: 0,
                    centerWeight: 0,
                    ease: easeValues[event.eventEase] as EaseTypeValue,
                })),
                hasTransforms: false,
            }
            props.hasTransforms = props.transforms.length > 0
            const breakpoints = new Set(state.bpms.map((bpm) => bpm.x))
            // Preserve exact source beats at jumps. A time round trip can move
            // an event by one ulp and make its left-limit query select the right.
            for (const events of [stageMasks, stagePivots, stageStyles, stageTransforms]) {
                for (const event of events) breakpoints.add(event.beat)
            }
            for (const events of [props.masks, props.pivots, props.styles, props.transforms]) {
                for (const [i, event] of events.entries()) {
                    const next = events[i + 1]
                    if (next && event.ease === easeValues.inOutStep) {
                        breakpoints.add(timeToBeat(state.bpms, (event.time + next.time) / 2))
                    }
                }
            }
            for (const [index, event] of props.pivots.entries()) {
                const next = props.pivots[index + 1]
                if (!next || next.time <= event.time) continue
                const phase = (value: typeof event) =>
                    divisionPhase({ size: value.divisionSize, parity: value.divisionParity })
                if (phase(event) === phase(next)) continue
                for (const fraction of gridCrossings(event.ease)) {
                    breakpoints.add(timeToBeat(state.bpms, lerp(event.time, next.time, fraction)))
                }
            }
            stages.set(stageId, {
                startBeat,
                endBeat,
                breakpoints: [...breakpoints].sort((a, b) => a - b),
                props,
            })
        }
    }
    stageCache = { dependencies, stages }

    const stage = (stageId: StageId, beat: number, options: LimitOptions = {}) => {
        const data = stages.get(stageId)
        if (!data) return
        const props = getStageProps(data.props, toTime(beat), options)
        return {
            ...props,
            left: props.lane - props.width + props.xLaneTranslate,
            right: props.lane + props.width + props.xLaneTranslate,
            visible: beat >= data.startBeat && beat <= data.endBeat,
        }
    }
    const offset = (stageId: StageId, beat: number, options: LimitOptions = {}) => {
        const data = stages.get(stageId)
        if (!data) return 0
        const props = getStageProps(data.props, toTime(beat), options)
        return props.pivotLane + props.xLaneTranslate
    }
    const gridOffset = (stageId: StageId, beat: number, options: LimitOptions = {}) => {
        const data = stages.get(stageId)
        return data
            ? divisionGridOffset(getStageProps(data.props, toTime(beat), options).division)
            : 0
    }
    const gridOrigin = (stageId: StageId, beat: number, options: LimitOptions = {}) => {
        const data = stages.get(stageId)
        if (!data) return 0
        const props = getStageProps(data.props, toTime(beat), options)
        return props.pivotLane + props.xLaneTranslate + divisionGridOffset(props.division)
    }
    const between = (
        head: NoteEntity,
        tail: NoteEntity,
        beat: number,
        options: LimitOptions,
        easeBeat = beat,
        attachedNote?: NoteEntity,
    ): ComposedPosition => {
        const start = toTime(head.beat)
        const end = toTime(tail.beat)
        const fraction = ease(
            easeValues[head.connectorEase] as EaseTypeValue,
            (attachedNote && sameBeatAttachmentFraction(head, tail, attachedNote)) ??
                (Math.abs(end - start) < 1e-6 ? 0.5 : unlerpClamped(start, end, toTime(easeBeat))),
        )
        const size = Math.max(0, lerp(head.size, tail.size, fraction))
        const center = lerp(
            head.left + head.size / 2 + offset(head.stageId, beat, options),
            tail.left + tail.size / 2 + offset(tail.stageId, beat, options),
            fraction,
        )
        return { left: center - size / 2, size }
    }
    const infoLookups = new WeakMap<
        readonly SlideInfos[number][],
        Map<NoteEntity, SlideInfos[number]>
    >()
    const notePosition = (
        note: NoteEntity,
        beat = note.beat,
        options: ComposedOptions = {},
    ): ComposedPosition => {
        // Basic charts retain the store's exact, rounded attached-note positions.
        if (!state.isDynamicStages) return { left: note.left, size: note.size }
        const infos = options.slideInfos ?? state.store.slides.info.get(note.slideId)
        if (note.isAttached && infos && infos[0]?.note !== note && infos.at(-1)?.note !== note) {
            let lookup = infoLookups.get(infos)
            if (!lookup) {
                lookup = new Map(infos.map((info) => [info.note, info]))
                infoLookups.set(infos, lookup)
            }
            const info = lookup.get(note)
            if (info) return between(info.attachHead, info.attachTail, beat, options, beat, note)
        }
        return { left: note.left + offset(note.stageId, beat, options), size: note.size }
    }
    const noteLeft = (note: NoteEntity, options: ComposedOptions = {}) =>
        notePosition(note, note.beat, options).left
    const hitbox = (entity: Entity, options: ComposedOptions = {}): EntityHitbox | undefined => {
        if (entity.type !== 'note' || !entity.hitbox || !state.isDynamicStages) return entity.hitbox
        const position = notePosition(entity, entity.beat, options)
        return { ...entity.hitbox, lane: position.left + position.size / 2, w: position.size / 2 }
    }
    const connectorPosition = (
        connector: ConnectorEntity,
        beat: number,
        options: LimitOptions = {},
    ): ComposedPosition => {
        const { head, tail, attachHead, attachTail } = connector
        const isAttached = (note: NoteEntity) =>
            note.isAttached && note !== attachHead && note !== attachTail
        const spanStart = toTime(attachHead.beat)
        const spanEnd = toTime(attachTail.beat)
        const fractionAt = (note: NoteEntity) =>
            sameBeatAttachmentFraction(attachHead, attachTail, note) ??
            (Math.abs(spanEnd - spanStart) < 1e-6
                ? 0.5
                : unlerpClamped(spanStart, spanEnd, toTime(note.beat)))
        const endpoint = (note: NoteEntity) =>
            isAttached(note)
                ? between(attachHead, attachTail, beat, options, note.beat, note)
                : { left: note.left + offset(note.stageId, beat, options), size: note.size }
        const a = endpoint(head)
        const type = (isAttached(head) ? attachHead : head).connectorEase
        if (type === 'none' || type === 'inStep') return a
        const b = endpoint(tail)
        const headFraction = isAttached(head) ? fractionAt(head) : 0
        const tailFraction = isAttached(tail) ? fractionAt(tail) : 1
        const start = toTime(head.beat)
        const end = toTime(tail.beat)
        const fraction =
            Math.abs(end - start) < 1e-6 ? 0.5 : unlerpClamped(start, end, toTime(beat))
        const target = lerp(headFraction, tailFraction, fraction)
        const easeType = easeValues[type] as EaseTypeValue
        const endpointEase = (fraction: number) =>
            fraction <= 0 ? 0 : fraction >= 1 ? 1 : ease(easeType, fraction)
        const headEased = endpointEase(headFraction)
        const tailEased = endpointEase(tailFraction)
        // Slice endpoints use the corresponding side of an In-Out Step jump.
        const targetEased =
            type === 'inOutStep'
                ? eventProgress(easeType, target, 0, 1, options.rightLimit)
                : ease(easeType, target)
        const blend =
            Math.abs(tailEased - headEased) < 1e-6
                ? fraction
                : (targetEased - headEased) / (tailEased - headEased)
        const size = Math.max(0, lerp(a.size, b.size, blend))
        const center = lerp(a.left + a.size / 2, b.left + b.size / 2, blend)
        return { left: center - size / 2, size }
    }

    return {
        stages,
        stage,
        offset,
        gridOffset,
        gridOrigin,
        notePosition,
        noteLeft,
        hitbox,
        connectorPosition,
    }
}

export type ComposedLayout = ReturnType<typeof buildComposedLayout>

/** States are immutable snapshots, so discarded drag/undo snapshots release their geometry. */
export const createComposedLayout = (state: State): ComposedLayout => {
    let record = layouts.get(state)
    const previous = lastLayout?.deref()
    if (!record) {
        // Selection, names and audio changes leave the geometry untouched. Keeping
        // its identity also preserves connector paths through those state changes.
        const source = previous?.source
        record =
            previous &&
            source?.store === state.store &&
            source.bpms === state.bpms &&
            source.stages === state.stages &&
            source.isDynamicStages === state.isDynamicStages
                ? previous
                : { source: state, layout: buildComposedLayout(state) }
        layouts.set(state, record)
    }
    // Weak ownership avoids retaining a closed chart when Basic is opened next.
    if (record !== previous) lastLayout = new WeakRef(record)
    return record.layout
}
