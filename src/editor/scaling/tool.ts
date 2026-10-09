import { buildPreviewChart } from '../../preview/engine/chart'
import { getStageProps } from '../../preview/engine/stage'
import { beatToTime, timeToBeat, type BpmIntegral } from '../../state/integrals/bpms'
import { isEditableEntity, type EditableEntity } from '../../state/operations/editable'
import {
    getScaleBounds,
    getScaleEntities,
    getScaleProperties,
    getScaleValue,
} from '../../state/operations/scaleValues'
import { transformSelection } from '../../state/operations/transformSelection'
import { align } from '../../utils/math'
import { getScaleLabels } from '../commands/scaleSelection/labels'
import {
    beginScalingDrag,
    cancelScalingDrag,
    endScalingDrag,
    getScalingBaselineEntity,
    hasScalingRange,
    scalingSession,
    updateScalingDrag,
} from '../commands/scaleSelection/session'
import { inverseAffine } from '../composedPointer'
import { getComposedLayout } from '../composedView'
import { inverseAttachedElevation, type AttachedElevationDrag } from '../elevation/drag'
import { elevationNotes } from '../elevation/scene'
import { editorNavigation, type EditorNavigation } from '../navigation'
import { hitAllSceneEntities, hitSceneEntities, sceneBpms, sceneState } from '../sceneState'
import type { Tool } from '../tools'
import { comparePointHits, isNoteResizeStart, isVisible, offset } from '../tools/utils'
import { view, xToLane, yToTime } from '../view'

let dragBpms: BpmIntegral[] | undefined
let elevationDrag:
    | {
          start: number
          displayed: number
          response: AttachedElevationDrag
          navigation: EditorNavigation
          previous: number
      }
    | undefined
let widthDrag:
    | {
          start: number
          anchor: number
          projection: number
          rawPerDisplayed: number
          origin: number
          navigation?: EditorNavigation
      }
    | undefined

const matchesAxis = () =>
    scalingSession.value?.axis === 'width' ||
    scalingSession.value?.axis === (editorNavigation.value ? 'elevation' : 'beat')

const canDrag = () => matchesAxis() && hasScalingRange()

const pointerLane = (x: number, y: number) => {
    const navigation = widthDrag ? widthDrag.navigation : editorNavigation.value
    return navigation?.positionAtPoint(x, y).lane ?? xToLane(x)
}

const pointerValue = (x: number, y: number) => {
    if (scalingSession.value?.axis === 'width') {
        const lane = pointerLane(x, y)
        if (widthDrag?.rawPerDisplayed === 0) return widthDrag.start
        return widthDrag
            ? widthDrag.start +
                  offset(
                      widthDrag.start,
                      widthDrag.projection === 0 && widthDrag.rawPerDisplayed === 1
                          ? lane
                          : widthDrag.start +
                                (lane - widthDrag.projection - widthDrag.start) *
                                    widthDrag.rawPerDisplayed,
                      widthDrag.anchor,
                      widthDrag.origin,
                  )
            : lane
    }
    if (elevationDrag) {
        const target =
            elevationDrag.displayed +
            elevationDrag.navigation.positionAtPoint(x, y).elevation -
            elevationDrag.start
        const delta = inverseAttachedElevation(
            elevationDrag.response,
            target,
            elevationDrag.previous,
        )
        elevationDrag.previous = delta
        return elevationDrag.start + delta
    }
    return editorNavigation.value
        ? editorNavigation.value.positionAtPoint(x, y).elevation
        : align(timeToBeat(dragBpms ?? sceneBpms.value, Math.max(0, yToTime(y))), view.division)
}

const selectedEntitiesAtPoint = (x: number, y: number, minimumWidth: number) => {
    const navigation = editorNavigation.value
    const lane = xToLane(x)
    const axis = scalingSession.value?.axis
    if (!axis) return []
    const composed = navigation ? undefined : getComposedLayout(sceneState.value)
    const hits = navigation
        ? navigation.hitPoint(x, y, minimumWidth)
        : axis === 'width'
          ? hitAllSceneEntities(
                xToLane(x - 10),
                xToLane(x + 10),
                yToTime(y + 10),
                yToTime(y - 10),
                minimumWidth,
            )
          : hitSceneEntities(
                'note',
                xToLane(x - 10),
                xToLane(x + 10),
                yToTime(y + 10),
                yToTime(y - 10),
                minimumWidth,
            )
    return hits
        .filter((entity): entity is EditableEntity => {
            const position =
                entity.type === 'note' && composed
                    ? composed.notePosition(entity)
                    : entity.type === 'note'
                      ? entity
                      : undefined
            return (
                isEditableEntity(entity) &&
                (axis === 'width' || entity.type === 'note') &&
                isVisible(entity) &&
                Number.isFinite(getScaleValue(entity, axis)) &&
                (navigation !== undefined ||
                    entity.type !== 'note' ||
                    (position !== undefined &&
                        lane >=
                            position.left +
                                position.size / 2 -
                                Math.max(position.size, minimumWidth) / 2 &&
                        lane <=
                            position.left +
                                position.size / 2 +
                                Math.max(position.size, minimumWidth) / 2)) &&
                getScalingBaselineEntity(entity) !== undefined
            )
        })
        .sort(comparePointHits)
}

export const scalingTool: Tool = {
    title: () => getScaleLabels(scalingSession.value?.axis ?? 'beat').title,
    secondaryTool: false,
    hover(x, y) {
        view.entities = {
            hovered: matchesAxis() ? selectedEntitiesAtPoint(x, y, 0.5) : [],
            creating: [],
        }
    },
    cursor(x, y) {
        if (!canDrag() || !selectedEntitiesAtPoint(x, y, 1.5).length) return 'default'
        return scalingSession.value?.axis === 'width' ? 'ew-resize' : 'ns-resize'
    },
    dragStart(x, y) {
        dragBpms = undefined
        widthDrag = undefined
        elevationDrag = undefined
        if (!canDrag()) return false
        const value = pointerValue(x, y)
        const started = selectedEntitiesAtPoint(x, y, 1.5).some((entity) => {
            if (scalingSession.value?.axis !== 'width') {
                if (!beginScalingDrag(entity, value)) return false
                const navigation = editorNavigation.value
                if (
                    scalingSession.value?.axis !== 'elevation' ||
                    !navigation ||
                    entity.type !== 'note' ||
                    !entity.isAttached
                )
                    return true
                const source = sceneState.value
                const info = source.store.slides.info
                    .get(entity.slideId)
                    ?.find((info) => info.note === entity)
                if (
                    info &&
                    info.attachHead !== entity &&
                    info.attachTail !== entity &&
                    info.attachHead.beat === info.attachTail.beat
                ) {
                    const selected = getScaleEntities(source.selectedEntities, 'elevation', source)
                    const heights = selected.map((item) => getScaleValue(item, 'elevation'))
                    const min = Math.min(...heights)
                    const max = Math.max(...heights)
                    const focus = entity.elevation
                    const endpoint = selected.includes(entity) && (focus === min || focus === max)
                    const anchor = focus === min ? max : min
                    const coefficient = (item: EditableEntity) =>
                        selected.includes(item)
                            ? endpoint
                                ? (getScaleValue(item, 'elevation') - anchor) / (focus - anchor)
                                : 1
                            : 0
                    // Measure stage contributions from the same immutable raw edit.
                    // Endpoint scaling and body translation both give affine inputs
                    // to the attachment's rational elevation response.
                    const probe = transformSelection(
                        source,
                        source.selectedEntities,
                        new Map(
                            selected.map((item) => [
                                item,
                                { elevation: getScaleValue(item, 'elevation') + coefficient(item) },
                            ]),
                        ),
                    )
                    const beforeChart = buildPreviewChart(source, 10)
                    const afterChart = buildPreviewChart(probe, 10)
                    const stageIds = [...source.stages.keys()]
                    const stageElevation = (chart: typeof beforeChart, note: typeof entity) => {
                        const stage = source.isDynamicStages
                            ? chart.stages[stageIds.indexOf(note.stageId)]
                            : undefined
                        return stage
                            ? getStageProps(stage, beatToTime(source.bpms, note.beat)).elevation
                            : 0
                    }
                    const headStage = stageElevation(beforeChart, info.attachHead)
                    const tailStage = stageElevation(beforeChart, info.attachTail)
                    const row = elevationNotes.value.find((row) => row.note === entity)
                    if (row)
                        elevationDrag = {
                            start: value,
                            displayed: row.elevation,
                            navigation,
                            previous: 0,
                            response: {
                                head: info.attachHead.elevation,
                                tail: info.attachTail.elevation,
                                note: entity.elevation,
                                headStage,
                                tailStage,
                                headMoves: coefficient(info.attachHead),
                                tailMoves: coefficient(info.attachTail),
                                noteMoves: coefficient(entity),
                                headStageMoves:
                                    stageElevation(afterChart, info.attachHead) - headStage,
                                tailStageMoves:
                                    stageElevation(afterChart, info.attachTail) - tailStage,
                            },
                        }
                }
                return true
            }
            const session = scalingSession.value
            const baseline = getScalingBaselineEntity(entity)
            if (!baseline) return false
            const navigation = editorNavigation.value
            const composed = navigation ? undefined : getComposedLayout(sceneState.value)
            const row =
                navigation && entity.type === 'note'
                    ? elevationNotes.value.find((row) => row.note === entity)
                    : undefined
            const bounds = row
                ? { min: row.lane - row.size / 2, max: row.lane + row.size / 2 }
                : entity.type === 'note' && composed
                  ? (() => {
                        const position = composed.notePosition(entity)
                        return { min: position.left, max: position.left + position.size }
                    })()
                  : getScaleBounds(entity, 'width')
            const size = bounds.max - bounds.min
            const hasEdges =
                (entity.type === 'note' ||
                    entity.type === 'cameraEventJoint' ||
                    entity.type === 'stageMaskEventJoint') &&
                getScaleEntities(session.selected, 'width', session.source).includes(baseline)
            const edge =
                hasEdges && isNoteResizeStart({ left: bounds.min, size }, value)
                    ? value < (bounds.min + bounds.max) / 2
                        ? 'min'
                        : 'max'
                    : undefined
            // Infer the raw operation from its complete displayed response, using
            // this immutable grab snapshot. Selected stage controls move with notes.
            const projection =
                composed && entity.type === 'note'
                    ? bounds.min - getScaleBounds(entity, 'width').min
                    : 0
            const rawValue = value - projection
            if (!beginScalingDrag(entity, rawValue, edge)) return false
            let rawPerDisplayed = 1
            if (composed && entity.type === 'note') {
                const source = sceneState.value
                const selected = getScaleEntities(source.selectedEntities, 'width', source)
                let anchor = edge === 'min' ? -Infinity : Infinity
                for (const item of selected) {
                    const range = getScaleBounds(item, 'width')
                    anchor =
                        edge === 'min' ? Math.max(anchor, range.max) : Math.min(anchor, range.min)
                }
                const rawBounds = getScaleBounds(entity, 'width')
                const endpoint =
                    selected.includes(entity) && edge !== undefined && rawBounds[edge] !== anchor
                const rawStep = endpoint ? rawBounds[edge] - anchor : 1
                // Unconstrained probes measure geometry only. Camera-size and lane
                // limits still validate the actual operation in the raw session.
                const probe = transformSelection(
                    source,
                    source.selectedEntities,
                    new Map(
                        selected.map((item) => [
                            item,
                            getScaleProperties(
                                item,
                                'width',
                                endpoint
                                    ? anchor + (getScaleValue(item, 'width') - anchor) * 2
                                    : getScaleValue(item, 'width') + 1,
                                endpoint ? 2 : 1,
                            ),
                        ]),
                    ),
                )
                const index = source.store.slides.note.get(entity.slideId)?.indexOf(entity) ?? -1
                const next = probe.store.slides.note.get(entity.slideId)?.[index]
                const nextLayout = getComposedLayout(probe)
                if (next && nextLayout) {
                    const position = nextLayout.notePosition(next)
                    const before = endpoint && edge === 'max' ? bounds.max : bounds.min
                    const after =
                        endpoint && edge === 'max' ? position.left + position.size : position.left
                    rawPerDisplayed =
                        inverseAffine(
                            before + 1,
                            { input: 0, output: before },
                            { input: rawStep, output: after },
                        ) ?? 0
                } else {
                    rawPerDisplayed = 0
                }
            }
            widthDrag = {
                start: rawValue,
                anchor: (edge ? bounds[edge] : bounds.min) - projection,
                projection,
                rawPerDisplayed,
                origin:
                    composed && entity.type === 'note'
                        ? composed.gridOffset(entity.stageId, entity.beat)
                        : 0,
                navigation,
            }
            return true
        })
        if (started && !editorNavigation.value) dragBpms = sceneBpms.value
        return started
    },
    dragUpdate(x, y) {
        updateScalingDrag(pointerValue(x, y))
    },
    dragEnd(x, y) {
        updateScalingDrag(pointerValue(x, y))
        endScalingDrag()
        dragBpms = undefined
        widthDrag = undefined
        elevationDrag = undefined
    },
    dragCancel() {
        dragBpms = undefined
        widthDrag = undefined
        elevationDrag = undefined
        cancelScalingDrag()
    },
}
