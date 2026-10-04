import { i18n } from '../../i18n'
import type { NoteEntity } from '../../state/entities/slides/note'
import { timeToBeat, type BpmIntegral } from '../../state/integrals/bpms'
import { align } from '../../utils/math'
import {
    beginScalingDrag,
    cancelScalingDrag,
    endScalingDrag,
    getScalingBaselineNote,
    scalingSession,
    updateScalingDrag,
} from '../commands/scaleSelection/session'
import { editorNavigation } from '../navigation'
import { hitSceneEntities, sceneBpms } from '../sceneState'
import type { Tool } from '../tools'
import { view, xToLane, yToTime } from '../view'

let dragBpms: BpmIntegral[] | undefined

const matchesAxis = () =>
    scalingSession.value?.axis === (editorNavigation.value ? 'elevation' : 'beat')

const pointerValue = (x: number, y: number) =>
    editorNavigation.value
        ? editorNavigation.value.positionAtPoint(x, y).elevation
        : align(timeToBeat(dragBpms ?? sceneBpms.value, Math.max(0, yToTime(y))), view.division)

const selectedNotesAtPoint = (x: number, y: number, minimumWidth: number) => {
    if (!view.visibilities.note) return []
    const navigation = editorNavigation.value
    const lane = xToLane(x)
    const hits = navigation
        ? navigation.hitPoint(x, y, minimumWidth)
        : hitSceneEntities(
              'note',
              xToLane(x - 10),
              xToLane(x + 10),
              yToTime(y + 10),
              yToTime(y - 10),
              minimumWidth,
          )
    return hits.filter(
        (entity): entity is NoteEntity =>
            entity.type === 'note' &&
            (view.groupId === undefined || entity.groupId === view.groupId) &&
            (view.stageId === undefined || entity.stageId === view.stageId) &&
            (navigation !== undefined ||
                (lane >= entity.left + entity.size / 2 - Math.max(entity.size, minimumWidth) / 2 &&
                    lane <=
                        entity.left + entity.size / 2 + Math.max(entity.size, minimumWidth) / 2)) &&
            getScalingBaselineNote(entity) !== undefined,
    )
}

export const scalingTool: Tool = {
    title: () =>
        scalingSession.value?.axis === 'elevation'
            ? i18n.value.commands.scaleElevation.title
            : i18n.value.commands.scaleBeat.title,
    secondaryTool: false,
    hover(x, y) {
        view.entities = {
            hovered: matchesAxis() ? selectedNotesAtPoint(x, y, 0.5) : [],
            creating: [],
        }
    },
    dragStart(x, y) {
        dragBpms = undefined
        if (!matchesAxis()) return false
        const value = pointerValue(x, y)
        const started = selectedNotesAtPoint(x, y, 1.5).some((note) =>
            beginScalingDrag(note, value),
        )
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
    },
    dragCancel() {
        dragBpms = undefined
        cancelScalingDrag()
    },
}
