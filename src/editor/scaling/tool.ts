import { timeToBeat, type BpmIntegral } from '../../state/integrals/bpms'
import { isEditableEntity, type EditableEntity } from '../../state/operations/editable'
import { getScaleBounds, getScaleEntities, getScaleValue } from '../../state/operations/scaleValues'
import { align } from '../../utils/math'
import { getScaleLabels } from '../commands/scaleSelection/labels'
import {
    beginScalingDrag,
    cancelScalingDrag,
    endScalingDrag,
    getScalingBaselineEntity,
    scalingSession,
    updateScalingDrag,
} from '../commands/scaleSelection/session'
import { elevationNotes } from '../elevation/scene'
import { editorNavigation } from '../navigation'
import { hitAllSceneEntities, hitSceneEntities, sceneBpms } from '../sceneState'
import type { Tool } from '../tools'
import { isNoteResizeStart, isVisible, offset } from '../tools/utils'
import { view, xToLane, yToTime } from '../view'

let dragBpms: BpmIntegral[] | undefined
let widthDrag: { start: number; anchor: number } | undefined

const matchesAxis = () =>
    scalingSession.value?.axis === 'width' ||
    scalingSession.value?.axis === (editorNavigation.value ? 'elevation' : 'beat')

const pointerLane = (x: number, y: number) =>
    editorNavigation.value?.positionAtPoint(x, y).lane ?? xToLane(x)

const pointerValue = (x: number, y: number) => {
    if (scalingSession.value?.axis === 'width') {
        const lane = pointerLane(x, y)
        return widthDrag ? widthDrag.start + offset(widthDrag.start, lane, widthDrag.anchor) : lane
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
    return hits.filter(
        (entity): entity is EditableEntity =>
            isEditableEntity(entity) &&
            (axis === 'width' || entity.type === 'note') &&
            isVisible(entity) &&
            Number.isFinite(getScaleValue(entity, axis)) &&
            (navigation !== undefined ||
                entity.type !== 'note' ||
                (lane >= entity.left + entity.size / 2 - Math.max(entity.size, minimumWidth) / 2 &&
                    lane <=
                        entity.left + entity.size / 2 + Math.max(entity.size, minimumWidth) / 2)) &&
            getScalingBaselineEntity(entity) !== undefined,
    )
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
    dragStart(x, y) {
        dragBpms = undefined
        widthDrag = undefined
        if (!matchesAxis()) return false
        const value = pointerValue(x, y)
        const started = selectedEntitiesAtPoint(x, y, 1.5).some((entity) => {
            if (scalingSession.value?.axis !== 'width') return beginScalingDrag(entity, value)
            const session = scalingSession.value
            const baseline = getScalingBaselineEntity(entity)
            if (!baseline) return false
            const row =
                editorNavigation.value && entity.type === 'note'
                    ? elevationNotes.value.find((row) => row.note === entity)
                    : undefined
            const bounds = row
                ? { min: row.lane - row.size / 2, max: row.lane + row.size / 2 }
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
            if (!beginScalingDrag(entity, value, edge)) return false
            widthDrag = { start: value, anchor: edge ? bounds[edge] : bounds.min }
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
    },
    dragCancel() {
        dragBpms = undefined
        widthDrag = undefined
        cancelScalingDrag()
    },
}
