import { ref } from 'vue'
import type { Tool } from '..'
import type { CameraZoomVerticalAlign } from '../../../chart/events/camera.ts'
import type { DivisionParity } from '../../../chart/events/stage/pivot'
import type {
    BorderStyle,
    JudgmentLineColor,
    JudgmentLineStyle,
} from '../../../chart/events/stage/style'
import type { Anchor } from '../../../chart/events/stage/transform.ts'
import type { GroupId } from '../../../chart/groups'
import type {
    ConnectorLayer,
    ConnectorPresentation,
    ConnectorType,
    FlickDirection,
    NoteSfx,
    NoteType,
} from '../../../chart/note'
import type { NoteStyle } from '../../../chart/noteStyle'
import type { StageId } from '../../../chart/stages'
import type { TimeScaleEase, TimeScaleTransition } from '../../../chart/timeScale'
import type { EaseEdit } from '../../../ease'
import { pushState, replaceState, state } from '../../../history'
import { selectedEntities } from '../../../history/selectedEntities'
import { i18n } from '../../../i18n'
import type { Entity } from '../../../state/entities'
import { planEdit } from '../../../state/operations/properties/plan'
import { interpolate } from '../../../utils/interpolate'
import { notify } from '../../notification'
import { revealAuthoringTarget } from '../../scope'
import {
    focusEntityAtBeat,
    focusViewAtBeat,
    setViewHover,
    view,
    xToLane,
    yToTime,
    yToValidBeat,
} from '../../view'
import {
    hitAllEntitiesAtPoint,
    hitAllEntitiesInSelection,
    modifyEntities,
    toSelection,
} from '../utils'
import BrushSidebar from './BrushSidebar.vue'

export type BrushProperties = {
    groupId?: GroupId
    stageId?: StageId
    noteStyle?: NoteStyle
    connectorStyle?: NoteStyle
    noteType?: NoteType
    isAttached?: boolean
    size?: number
    isCritical?: boolean
    flickDirection?: FlickDirection
    isFake?: boolean
    sfx?: NoteSfx
    isConnectorSeparator?: boolean
    connectorType?: ConnectorType
    connectorEase?: EaseEdit
    connectorIsFake?: boolean
    connectorActiveIsCritical?: boolean
    connectorGuideAlpha?: number
    connectorLayer?: ConnectorLayer
    connectorIsPassThrough?: boolean
    connectorPresentation?: ConnectorPresentation
    timeScale?: number
    skip?: number
    timeScaleEase?: EaseEdit<TimeScaleEase>
    timeScaleTransition?: TimeScaleTransition
    hideNotes?: boolean
    cameraSize?: number
    cameraZoom?: number
    cameraZoomTargetLane?: number
    cameraZoomTargetY?: number
    cameraZoomVerticalAlign?: CameraZoomVerticalAlign
    cameraRotation?: number
    cameraStageTilt?: number
    maskSize?: number
    isMaskNotes?: boolean
    divisionSize?: number
    divisionParity?: DivisionParity
    yOffset?: number
    yOffsetBeat?: number
    judgmentLineColor?: JudgmentLineColor
    judgmentLineStyle?: JudgmentLineStyle
    leftBorderStyle?: BorderStyle
    rightBorderStyle?: BorderStyle
    isFullWidth?: boolean
    noteAlpha?: number
    laneAlpha?: number
    judgmentLineAlpha?: number
    divisionLineAlpha?: number
    rotation?: number
    yTranslation?: number
    elevation?: number
    anchor?: Anchor
    eventEase?: EaseEdit
}

export const brushProperties = ref<BrushProperties>({})

let active:
    | {
          lane: number
          time: number
          count: number
      }
    | undefined

const tapTarget = (x: number, y: number) => {
    const entities = hitAllEntitiesAtPoint(x, y)
    return entities.some((entity) => selectedEntities.value.includes(entity))
        ? 'selection'
        : entities
}

export const brush: Tool = {
    title: () => i18n.value.tools.brush.title,
    sidebar: BrushSidebar,

    hover(x, y, modifiers) {
        const entities = modifyEntities(hitAllEntitiesAtPoint(x, y, 0.5), modifiers)

        view.entities = {
            hovered: entities,
            creating: [],
        }
    },

    tap(x, y, modifiers) {
        const entities = tapTarget(x, y)

        if (entities === 'selection') {
            apply(modifyEntities(selectedEntities.value, modifiers))
            focusEntityAtBeat(yToValidBeat(y))
        } else {
            const [entity] = entities
            if (entity) {
                apply(modifyEntities(entities, modifiers))
                focusEntityAtBeat(entity.beat)
            } else {
                const selectedLength = selectedEntities.value.length

                replaceState({
                    ...state.value,
                    selectedEntities: [],
                })
                view.entities = {
                    hovered: [],
                    creating: [],
                }

                focusViewAtBeat(yToValidBeat(y))
                if (selectedLength) notify(() => i18n.value.tools.brush.deselected)
            }
        }
    },

    cursor: (x, y) => (tapTarget(x, y).length ? 'pointer' : 'crosshair'),

    dragStart(x, y) {
        active = {
            lane: xToLane(x),
            time: yToTime(y),
            count: -1,
        }

        return true
    },

    dragUpdate(x, y, modifiers) {
        if (!active) return

        setViewHover(y)

        const selection = toSelection(active.lane, active.time, x, y)
        const targets = modifyEntities(hitAllEntitiesInSelection(selection), modifiers)

        replaceState({
            ...state.value,
            selectedEntities: targets,
        })
        view.selection = selection
        view.entities = {
            hovered: [],
            creating: [],
        }

        if (active.count === targets.length) return
        active.count = targets.length

        notify(interpolate(() => i18n.value.tools.brush.brushing, `${targets.length}`))
    },

    dragEnd(x, y, modifiers) {
        if (!active) return

        const selection = toSelection(active.lane, active.time, x, y)

        view.selection = undefined

        apply(modifyEntities(hitAllEntitiesInSelection(selection), modifiers))

        active = undefined
    },

    dragCancel() {
        active = undefined
    },
}

export const applyBrushToEntities = (entities: Entity[]) => {
    if (!entities.length) {
        replaceState({
            ...state.value,
            selectedEntities: [],
        })
        view.entities = {
            hovered: [],
            creating: [],
        }
        return
    }

    // The brush writes every key it holds, as it always has, but never to BPM changes.
    const { state: brushed, changed } = planEdit(state.value, entities, brushProperties.value, {
        only: (entity) => entity.type !== 'bpm',
        single: false,
    })
    view.entities = {
        hovered: [],
        creating: [],
    }
    if (!changed.length) {
        // The brushed objects are selected even when nothing changes.
        replaceState({ ...state.value, selectedEntities: entities })
        notify(() => i18n.value.sidebars.default.noChange)
        return
    }

    // Brushing objects into a hidden group or stage reveals it, like authoring.
    revealAuthoringTarget(brushProperties.value)
    const message = interpolate(() => i18n.value.tools.brush.brushed, `${changed.length}`)
    pushState(message, brushed)
    notify(message)
}

const apply = applyBrushToEntities
