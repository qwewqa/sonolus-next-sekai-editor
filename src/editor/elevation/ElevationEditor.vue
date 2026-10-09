<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, useTemplateRef, watch, watchEffect } from 'vue'
import { isAppActive } from '../../activity'
import { clipboardEntry, updateClipboard } from '../../clipboard'
import { pushState, replaceState, state } from '../../history'
import { defaultGroupId } from '../../history/groups'
import { i18n } from '../../i18n'
import OffscreenNoteIndicators from '../OffscreenNoteIndicators.vue'
import {
    hitOffscreenIndicator,
    selectOffscreenNotes,
    useOffscreenIndicators,
} from '../offscreenIndicators'
import { groupOffscreenNotes, offscreenBadgeHitWidth } from '../offscreenNotes'
import { modals } from '../../modals'
import {
    confirmOnEnter,
    resyncInput,
    revertOnEscape,
    trackTypedText,
} from '../../modals/form/resync'
import { clearPreviewEdit, setPreviewEdit } from '../../preview/edit'
import { settings } from '../../settings'
import type { State } from '../../state'
import { hasSameChartData } from '../../state/data'
import type { NoteEntity } from '../../state/entities/slides/note'
import { beatToTime } from '../../state/integrals/bpms'
import { editSelectedNote } from '../../state/operations/note'
import { getNoteFieldsIn } from '../../state/operations/properties/noteFields'
import { editChanges } from '../../state/operations/properties/plan'
import { createTransaction } from '../../state/transaction'
import { isComposingKey } from '../../utils/composition'
import { alignComputed, alignNear, clamp, shiftComputed } from '../../utils/math'
import { createNameLayer, placeNames } from '../canvas/names'
import { createNoteRenderer } from '../canvas/notes'
import { createFrameScheduler } from '../canvas/surface'
import type { EditorDrawContext } from '../canvas/types'
import { activateEditorNavigation, controlsForNavigation, useCanvasCursor } from '../controls'
import { cancelMouseControls } from '../controls/mouse'
import { cancelTouchControls } from '../controls/touch'
import type { Modifiers } from '../controls/gestures/pointer'
import { notifyPaneMoved } from '../controls/gestures/recognizers/drag'
import { editorNavigation, type EditorNavigation } from '../navigation'
import { closeContextMenu, contextMenu } from '../contextMenu'
import { constrainLaneObject, minimumNoteSize } from '../laneLimits'
import { isSidebarVisible, revealPropertiesSection } from '../sidebars'
import { panelTools, tools, toolName, type Tool } from '../tools'
import { applyBrushToEntities } from '../tools/brush'
import { remove } from '../tools/eraser'
import { applyGeneratedSlideNotes } from '../tools/generateSlideNotes'
import { defaultNoteProperties } from '../tools/note'
import { defaultSlideProperties } from '../tools/slide'
import SelectionPropertiesModal from '../workspace/properties/SelectionPropertiesModal.vue'
import { quickEdit } from '../utils/quickEdit'
import LevelEditorToolbar from '../toolbar/LevelEditorToolbar.vue'
import EditorToolModalHost from '../EditorToolModalHost.vue'
import LevelEditorNotification from '../LevelEditorNotification.vue'
import ChevronIcon from '../workspace/ChevronIcon.vue'
import CloseIcon from '../workspace/CloseIcon.vue'
import { hasToolModal, showToolModal } from '../toolModals'
import type { CommandName } from '../commands'
import { deselect } from '../commands/deselect'
import { fromDisplayedBeat, toDisplayedBeat } from '../beatDisplay'
import { isNoteResizeStart, modifyEntities, offset, resize } from '../tools/utils'
import { scopeLookup } from '../scope'
import { isScopeReduced } from '../scopeRules'
import { dockKeysAttribute, isInWorkspaceDock } from '../workspace'
import { alignLane, view, focusViewAtBeat } from '../view'
import {
    elevationGridDivision,
    snapElevation,
    sameBeat,
    type ElevationNote,
    type ElevationRow,
} from './layout'
import {
    createElevationNote,
    elevationNoteMinimum,
    pasteElevationNotes,
    previewElevationNote,
    previewElevationPaste,
} from './actions'
import { elevationLayout, elevationNotes, elevationState, getElevationStageProps } from './scene'
import {
    closeElevationEditor,
    elevationBeat,
    elevationToolNames,
    isElevationEditorOpen,
    isElevationSideBySide,
} from './state'
import { elevationBounds, elevationViewport, fitElevationViewport } from './viewport'
import { drawElevationConnections, getElevationConnections } from './connections'
import SelectValue from '../../modals/form/SelectValue.vue'
import { inverseAttachedElevation, type AttachedElevationDrag } from './drag'

const canvas = useTemplateRef<HTMLCanvasElement>('canvas')
const container = useTemplateRef<HTMLElement>('container')
const header = useTemplateRef<HTMLDivElement>('header')
const beatInput = useTemplateRef<HTMLInputElement>('beatInput')
const headerHeight = ref(80)
// Header controls follow the workspace chrome language: compact dark icon
// buttons whose hit area grows to 36px (fine) or 44px (coarse), and white
// pill fields with an accent focus ring on the dark band.
const headerIconButton =
    "relative flex size-8 shrink-0 items-center justify-center rounded-full text-white/80 transition-colors before:absolute before:-inset-0.5 before:content-[''] hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent active:bg-accent active:text-on-accent disabled:pointer-events-none disabled:opacity-40 [@media(pointer:coarse)]:before:-inset-1.5"
const headerField =
    'elevation-field h-8 w-20 appearance-none rounded-full bg-button px-3 text-base text-fg tabular-nums shadow-md transition-colors hover:shadow-accent outline-none focus:ring-accent active:bg-accent active:text-on-accent'
let navigation: EditorNavigation | undefined
const { cursor, cursorListeners } = useCanvasCursor(() => navigation)
const controlListeners = { ...controlsForNavigation(() => navigation), ...cursorListeners }
const activate = () => {
    if (navigation) activateEditorNavigation(navigation)
}
const xToLane = (x: number) =>
    elevationLayout.value.laneLeft + (x - elevationBounds.x) / elevationLayout.value.laneScale
const availableCommands: CommandName[] = [
    'open',
    'save',
    'reset',
    'properties',
    'utilities',
    'play',
    'stop',
    'speedUp',
    'speedDown',
    'toggleBgmVolume',
    'toggleSfxVolume',
    'bgm',
    'select',
    'elevation',
    'deselect',
    'eraser',
    'brush',
    'paste',
    'cut',
    'copy',
    'deleteSelection',
    'undo',
    'redo',
    'flip',
    'combineNotes',
    'splitHold',
    'scaleBeat',
    'scaleElevation',
    'scaleWidth',
    'makeVertical',
    'increaseNoteSize',
    'decreaseNoteSize',
    'note',
    'note0',
    'note1',
    'note2',
    'note3',
    'slide',
    'slide0',
    'slide1',
    'slide2',
    'slide3',
    'slide4',
    'generateSlideNotes',
    'manageGroups',
    'groupAll',
    'groupNext',
    'groupPrev',
    'manageStages',
    'stageAll',
    'stageNext',
    'stagePrev',
    'noteVisibility',
    'snapping',
    'division1',
    'division2',
    'division3',
    'division4',
    'division6',
    'division8',
    'division12',
    'division16',
    'divisionCustom',
    'laneSnapping',
    'laneDivision1',
    'laneDivision2',
    'laneDivision3',
    'laneDivision4',
    'laneDivision6',
    'laneDivision8',
    'laneDivision12',
    'laneDivision16',
    'laneDivisionCustom',
    'laneLimitNone',
    'laneLimitSix',
    'laneLimitCustom',
    'zoomXIn',
    'zoomXOut',
    'zoomYIn',
    'zoomYOut',
    'scrollLeft',
    'scrollRight',
    'scrollUp',
    'scrollDown',
    'scrollPageUp',
    'scrollPageDown',
]
const fitViewport = () => {
    fitElevationViewport(elevationBounds.h, elevationNotes.value, {
        top:
            (header.value?.clientHeight ?? 80) +
            Math.max(20, 1.25 * elevationLayout.value.laneScale),
        bottom: 140,
    })
}
const frame = createFrameScheduler()
const notes = createNoteRenderer()
const pixelRatio = ref(devicePixelRatio || 1)
const hovered = ref<NoteEntity>()
const offscreenGroups = computed(() => {
    const selected = new Set(elevationState.value.selectedEntities)
    return groupOffscreenNotes(
        elevationLayout.value.rows.map((row) => ({
            left: row.x - row.w / 2,
            right: row.x + row.w / 2,
            y: row.y,
            highlighted: selected.has(row.note),
            opacity: row.attached ? 0.6 : 1,
            target: row.note,
        })),
        elevationBounds.w,
        headerHeight.value + 4,
        elevationBounds.h,
    )
})
useOffscreenIndicators({
    navigation: () => navigation,
    bounds: () => elevationBounds,
    groups: () => offscreenGroups.value,
})
// Only the select-like tools pick notes from the badges.
const hitIndicator = (x: number, y: number) =>
    toolName.value === 'select' || toolName.value === 'elevation'
        ? hitOffscreenIndicator(x, y)
        : undefined
const hoveredOffscreenGroup = computed(() =>
    cursor.value === 'pointer' ? hitIndicator(view.pointer.x, view.pointer.y) : undefined,
)
const creating = ref<ElevationNote[]>([])
let adding: { lane: number; elevation: number; slide: boolean } | undefined
let viewportAdjusted = false
let mounted = false
const selection = ref<{ x: number; y: number; w: number; h: number }>()
let drag:
    | {
          source: State
          row: ElevationRow
          targets: NoteEntity[]
          lane: number
          elevation: number
          deltaLane: number
          deltaElevation: number
          resizing: boolean
          anchor: number
          movingEdge: number
          attachment?: AttachedElevationDrag
      }
    | undefined
let marquee: { x: number; y: number; selected: State['selectedEntities'] } | undefined

const yToElevation = (y: number) =>
    elevationViewport.center +
    (elevationBounds.h / 2 - y + elevationBounds.y) / elevationViewport.scale
const hit = (x: number, y: number, minimum = 1.5) => {
    const rows = elevationLayout.value.rows
    const matches = rows.filter(
        (row) =>
            Math.abs(x - elevationBounds.x - row.x) <=
                Math.max(row.w, minimum * elevationLayout.value.laneScale) / 2 + 10 &&
            Math.abs(y - elevationBounds.y - row.y) <=
                Math.max(14, elevationLayout.value.laneScale * 0.3 + 10),
    )
    const direct = matches.filter(
        (row) =>
            Math.abs(x - elevationBounds.x - row.x) <=
            Math.max(row.w, minimum * elevationLayout.value.laneScale) / 2,
    )
    return (direct.length ? direct : matches).sort(
        (a, b) =>
            +elevationState.value.selectedEntities.includes(b.note) -
                +elevationState.value.selectedEntities.includes(a.note) ||
            Math.abs(a.y - y + elevationBounds.y) - Math.abs(b.y - y + elevationBounds.y),
    )[0]
}
const cancel = () => {
    if (drag) clearPreviewEdit()
    drag = undefined
    marquee = undefined
    adding = undefined
    creating.value = []
    selection.value = undefined
}
const editedObject = (active: NonNullable<typeof drag>, note: NoteEntity) => {
    if (!getNoteFieldsIn(active.source.store, note).left)
        return { elevation: note.elevation + active.deltaElevation }
    const [left, size] = active.resizing
        ? resize(
              active.anchor,
              active.movingEdge + active.deltaLane,
              minimumNoteSize(note.noteType),
              Number.POSITIVE_INFINITY,
              active.movingEdge,
          )
        : [
              active.deltaLane === 0 ? note.left : alignComputed(note.left + active.deltaLane),
              note.size,
          ]
    return constrainLaneObject(
        {
            noteType: note.noteType,
            left,
            size,
            elevation: note.elevation + active.deltaElevation,
        },
        {
            enabled:
                note === active.row.note && (active.deltaLane !== 0 || active.deltaElevation !== 0),
            resizing: active.resizing,
        },
    )
}
const edit = (active: NonNullable<typeof drag>) => {
    const transaction = createTransaction(active.source)
    const replacements = new Map(
        active.targets.flatMap((note) => {
            const replacement = editSelectedNote(transaction, note, editedObject(active, note))[0]
            return replacement ? [[note, replacement] as const] : []
        }),
    )
    return transaction.commit(
        active.source.selectedEntities.map((entity) =>
            entity.type === 'note' ? (replacements.get(entity) ?? entity) : entity,
        ),
    )
}
const selectAt = (row: ElevationRow | undefined, modifiers: Modifiers) => {
    const selected = state.value.selectedEntities
    const targets = row ? modifyEntities([row.note], modifiers) : []
    replaceState({
        ...state.value,
        selectedEntities: modifiers.ctrl
            ? row && selected.includes(row.note)
                ? selected.filter((entity) => !targets.includes(entity))
                : [...new Set([...selected, ...targets])]
            : targets,
    })
}
const positionAtPoint = (x: number, y: number) => ({
    lane: xToLane(x),
    beat: elevationBeat.value,
    elevation: snapElevation(yToElevation(y), settings.elevationSnap),
})
const ghostRows = (entities: NoteEntity[]) =>
    entities
        .filter((note) => sameBeat(note.beat, elevationBeat.value))
        .map((note, order) => {
            const stage = getElevationStageProps(note.stageId, note.beat)
            return {
                note,
                lane: note.left + note.size / 2 + stage.pivotLane,
                size: note.size,
                elevation: note.elevation + stage.elevation,
                attached: false,
                order,
            }
        })
const pasteAtPoint = async (x: number, y: number, modifiers: Modifiers) => {
    const source = state.value
    const position = positionAtPoint(x, y)
    const scope = scopeLookup.value
    try {
        await updateClipboard()
    } catch {
        if (!clipboardEntry.value?.data) return false
    }
    if (
        !mounted ||
        !isElevationEditorOpen.value ||
        !hasSameChartData(source, state.value) ||
        scopeLookup.value !== scope ||
        !sameBeat(elevationBeat.value, position.beat)
    )
        return false
    await pasteElevationNotes(position.lane, position.elevation, position.beat, modifiers)
    creating.value = []
    return true
}
const applyToVisibleSelection = (row: ElevationRow, modifiers: Modifiers) => {
    const selected = state.value.selectedEntities
    const visible = new Set(elevationNotes.value.map((item) => item.note))
    return modifyEntities(selected.includes(row.note) ? selected : [row.note], modifiers).filter(
        (entity): entity is NoteEntity => entity.type === 'note' && visible.has(entity),
    )
}
const resolveDrag = (x: number, y: number) => {
    // Pressing an off-screen badge box-selects.
    if (hitIndicator(x, y)) return { type: 'marquee', row: undefined, indicator: true } as const
    const row = hit(x, y)
    if (toolName.value === 'paste') return { type: 'paste' } as const
    if (!row && (toolName.value === 'note' || toolName.value === 'slide'))
        return { type: 'add' } as const
    if (!row || ['eraser', 'brush', 'generateSlideNotes'].includes(toolName.value))
        return { type: 'marquee', row } as const
    if (row.attached)
        return {
            type: getNoteFieldsIn(elevationState.value.store, row.note).elevation
                ? 'move'
                : 'select',
            row,
        } as const
    return {
        type: isNoteResizeStart({ left: row.lane - row.size / 2, size: row.size }, xToLane(x))
            ? 'resize'
            : 'move',
        row,
    } as const
}
const cursors = {
    paste: 'copy',
    add: 'crosshair',
    select: 'pointer',
    resize: 'ew-resize',
    move: 'move',
} as const
const controls: Pick<
    Tool,
    'hover' | 'tap' | 'cursor' | 'dragStart' | 'dragUpdate' | 'dragEnd' | 'dragCancel'
> = {
    hover(x, y, modifiers) {
        const indicator = hitIndicator(x, y)
        if (indicator) {
            hovered.value = undefined
            creating.value = []
            view.entities = { hovered: modifyEntities(indicator.targets, modifiers), creating: [] }
            return
        }
        hovered.value = hit(x, y, 0.5)?.note
        const position = positionAtPoint(x, y)
        if (!hovered.value && (toolName.value === 'note' || toolName.value === 'slide'))
            creating.value = ghostRows([
                previewElevationNote(
                    alignLane(position.lane),
                    position.elevation,
                    position.beat,
                    toolName.value === 'slide',
                ),
            ])
        else if (toolName.value === 'paste')
            creating.value = ghostRows(
                previewElevationPaste(position.lane, position.elevation, position.beat, modifiers),
            )
        else creating.value = []
        view.entities = {
            hovered: hovered.value ? [hovered.value] : [],
            creating: creating.value.map((row) => row.note),
        }
    },
    tap(x, y, modifiers) {
        const indicator = hitIndicator(x, y)
        if (indicator) {
            selectOffscreenNotes(indicator.targets, modifiers)
            return
        }
        const row = hit(x, y)
        if (toolName.value === 'paste') {
            void pasteAtPoint(x, y, modifiers)
            return
        }
        if (row && toolName.value === 'eraser') {
            remove(applyToVisibleSelection(row, modifiers))
            return
        }
        if (row && toolName.value === 'brush') {
            applyBrushToEntities(applyToVisibleSelection(row, modifiers))
            return
        }
        if (row && toolName.value === 'generateSlideNotes') {
            applyGeneratedSlideNotes(applyToVisibleSelection(row, modifiers))
            return
        }
        if (toolName.value === 'note' || toolName.value === 'slide') {
            if (!row) {
                const position = positionAtPoint(x, y)
                createElevationNote(
                    alignLane(position.lane),
                    position.elevation,
                    position.beat,
                    toolName.value === 'slide',
                )
                creating.value = []
                return
            }
            if (!modifiers.ctrl && state.value.selectedEntities.includes(row.note)) {
                if (isSidebarVisible.value) {
                    revealPropertiesSection('selection')
                    quickEdit(
                        toolName.value === 'slide'
                            ? defaultSlideProperties.value
                            : defaultNoteProperties.value,
                    )
                } else
                    // The same docked tool dialog the main editor opens for this gesture.
                    void showToolModal(SelectionPropertiesModal, { kind: 'note' })
                return
            }
        }
        selectAt(row, modifiers)
    },
    cursor(x, y) {
        const target = resolveDrag(x, y)
        if (target.type !== 'marquee') return cursors[target.type]
        if ('indicator' in target) return 'pointer'
        // A tap applies eraser, brush and generate to the row.
        if (target.row) return 'pointer'
        return ['eraser', 'brush', 'generateSlideNotes'].includes(toolName.value)
            ? 'crosshair'
            : 'default'
    },
    dragStart(x, y, modifiers) {
        const target = resolveDrag(x, y)
        if (target.type === 'paste') return true
        if (target.type === 'add') {
            const position = positionAtPoint(x, y)
            adding = {
                lane: alignLane(position.lane),
                elevation: position.elevation,
                slide: toolName.value === 'slide',
            }
            return true
        }
        if (target.type === 'marquee') {
            marquee = {
                x: x - elevationBounds.x,
                y: y - elevationBounds.y,
                selected: state.value.selectedEntities,
            }
            return true
        }
        const { row } = target
        if (!state.value.selectedEntities.includes(row.note)) selectAt(row, modifiers)
        if (target.type === 'select') return false
        const eligible = new Set(
            elevationNotes.value
                .filter((item) => getNoteFieldsIn(state.value.store, item.note).elevation)
                .map((item) => item.note),
        )
        const resizing = target.type === 'resize'
        drag = {
            source: state.value,
            row,
            targets: resizing
                ? [row.note]
                : state.value.selectedEntities.filter(
                      (entity): entity is NoteEntity =>
                          entity.type === 'note' && eligible.has(entity),
                  ),
            lane: xToLane(x),
            elevation: yToElevation(y),
            deltaLane: 0,
            deltaElevation: 0,
            resizing,
            anchor: shiftComputed(row.note.left, xToLane(x) < row.lane ? row.note.size : 0),
            movingEdge: xToLane(x) < row.lane ? row.note.left : row.note.left + row.note.size,
        }
        if (row.attached) {
            const info = state.value.store.slides.info
                .get(row.note.slideId)
                ?.find((info) => info.note === row.note)
            if (info) {
                const { attachHead: head, attachTail: tail } = info
                drag.attachment = {
                    head: head.elevation,
                    tail: tail.elevation,
                    note: row.note.elevation,
                    headStage: getElevationStageProps(head.stageId, elevationBeat.value).elevation,
                    tailStage: getElevationStageProps(tail.stageId, elevationBeat.value).elevation,
                    headMoves: drag.targets.includes(head),
                    tailMoves: drag.targets.includes(tail),
                }
            }
        }
        return true
    },
    dragUpdate(x, y, modifiers) {
        if (adding) {
            const [left, size] = resize(
                adding.lane,
                xToLane(x),
                elevationNoteMinimum(elevationBeat.value, adding.slide),
            )
            creating.value = ghostRows([
                previewElevationNote(
                    left,
                    snapElevation(yToElevation(y), settings.elevationSnap),
                    elevationBeat.value,
                    adding.slide,
                    size,
                ),
            ])
            view.entities = { hovered: [], creating: creating.value.map((row) => row.note) }
            return
        }
        if (toolName.value === 'paste') {
            void controls.hover?.(x, y, modifiers)
            return
        }
        if (marquee) {
            const rect = {
                x: Math.min(marquee.x, x - elevationBounds.x),
                y: Math.min(marquee.y, y - elevationBounds.y),
                w: Math.abs(x - elevationBounds.x - marquee.x),
                h: Math.abs(y - elevationBounds.y - marquee.y),
            }
            selection.value = rect
            const targets = elevationLayout.value.rows
                .filter(
                    (row) =>
                        row.x + row.w / 2 >= rect.x &&
                        row.x - row.w / 2 <= rect.x + rect.w &&
                        row.y + 14 >= rect.y &&
                        row.y - 14 <= rect.y + rect.h,
                )
                .map((row) => row.note)
            replaceState({
                ...state.value,
                selectedEntities: modifiers.ctrl
                    ? [...new Set([...marquee.selected, ...targets])]
                    : targets,
            })
            return
        }
        if (!drag) return
        const deltaLane = drag.attachment
            ? 0
            : offset(drag.lane, xToLane(x), drag.resizing ? drag.movingEdge : drag.row.note.left)
        const delta = yToElevation(y) - drag.elevation
        const displayedDelta = drag.resizing
            ? 0
            : view.snapping === 'relative'
              ? snapElevation(delta, settings.elevationSnap)
              : snapElevation(drag.row.elevation + delta, settings.elevationSnap) -
                drag.row.elevation
        const deltaElevation = drag.attachment
            ? inverseAttachedElevation(
                  drag.attachment,
                  drag.row.elevation + displayedDelta,
                  drag.deltaElevation,
              )
            : displayedDelta
        if (deltaLane === drag.deltaLane && deltaElevation === drag.deltaElevation) return
        drag.deltaLane = deltaLane
        drag.deltaElevation = deltaElevation
        const active = { ...drag }
        setPreviewEdit(active.source, () => edit(active), [
            active.targets,
            deltaLane,
            deltaElevation,
        ])
    },
    dragEnd(x, y, modifiers) {
        controls.dragUpdate?.(x, y, modifiers)
        if (toolName.value === 'paste') {
            cancel()
            void pasteAtPoint(x, y, modifiers)
            return
        }
        if (adding) {
            const current = adding
            const [left, size] = resize(
                current.lane,
                xToLane(x),
                elevationNoteMinimum(elevationBeat.value, current.slide),
            )
            const elevation = snapElevation(yToElevation(y), settings.elevationSnap)
            cancel()
            createElevationNote(left, elevation, elevationBeat.value, current.slide, size)
            return
        }
        if (marquee && ['eraser', 'brush', 'generateSlideNotes'].includes(toolName.value)) {
            const targets = state.value.selectedEntities.filter(
                (entity): entity is NoteEntity =>
                    entity.type === 'note' &&
                    elevationNotes.value.some((row) => row.note === entity),
            )
            cancel()
            if (toolName.value === 'eraser') remove(targets)
            else if (toolName.value === 'brush') applyBrushToEntities(targets)
            else applyGeneratedSlideNotes(targets)
            return
        }
        const active = drag
        cancel()
        // A drop that changes nothing adds no undo step.
        if (
            active &&
            (active.deltaLane || active.deltaElevation) &&
            active.targets.some((note) =>
                editChanges(active.source.store, note, editedObject(active, note)),
            )
        )
            pushState(() => i18n.value.elevation.history, edit(active))
    },
    dragCancel: cancel,
}

const previousBeat = computed(() => {
    const beat = Math.max(0, alignNear(elevationBeat.value - 1 / view.division, view.division))
    return beat < elevationBeat.value ? beat : undefined
})
const nextBeat = computed(() => {
    const beat = alignNear(elevationBeat.value + 1 / view.division, view.division)
    return Number.isFinite(beat) && beat > elevationBeat.value ? beat : undefined
})
const changeBeat = (beat: number) => {
    if (!Number.isFinite(beat)) return
    cancelMouseControls()
    cancelTouchControls()
    cancel()
    const target = Math.max(0, beat)
    if (isElevationSideBySide.value) focusViewAtBeat(target)
    else view.cursorTime = beatToTime(state.value.bpms, target)
    // Moving the cursor converts back from time; keep the exact beat.
    elevationBeat.value = target
    fitViewport()
}
// Written on change only, so re-renders never overwrite the typing.
const beatField = computed({
    get: () => toDisplayedBeat(elevationBeat.value),
    set: (value: number | string) => {
        if (typeof value === 'number' && Number.isFinite(value) && value >= 1)
            changeBeat(fromDisplayedBeat(value))
    },
})
// Showing its committed beat, Ctrl+Z and Ctrl+Y go to the editor.
trackTypedText(beatInput, () => `${beatField.value}`)
// Pointer clicks on header buttons return keyboard shortcuts to the editor, as in docks.
const blurAfterPointer = (event: MouseEvent) => {
    if (event.detail > 0 && event.target instanceof Element) event.target.closest('button')?.blur()
}
const onKeydown = (event: KeyboardEvent) => {
    // An open drawer takes Escape first.
    if (modals.length || event.defaultPrevented || isComposingKey(event)) return
    if (editorNavigation.value !== navigation) return
    if (event.key !== 'Escape') return
    // The Beat field reverts uncommitted typing first.
    if (event.target === beatInput.value && beatInput.value?.value !== `${beatField.value}`) return
    if (event.target instanceof Element && event.target.closest('[role=separator]')) return
    // Workspace panels, their rails and menus handle their own Escape.
    if (isInWorkspaceDock(event.target instanceof Element ? event.target : null)) return
    event.preventDefault()
    event.stopPropagation()
    if (contextMenu.value) {
        closeContextMenu()
        return
    }
    // A drag's Escape only cancels it, before this runs.
    // Side by side, it runs Deselect, so a second press switches to Select as on the chart.
    if (!isElevationSideBySide.value) closeElevationEditor()
    // The Elevation tool already selects here, and closing returns the tool from before.
    else if (state.value.selectedEntities.length || toolName.value !== 'elevation')
        void deselect.execute()
}
// Its scroll and zoom move where a drag in it lands.
watch([() => elevationViewport.center, () => elevationViewport.scale], notifyPaneMoved)
watch([() => elevationBounds.w, () => elevationBounds.h], () => {
    cancelMouseControls()
    cancelTouchControls()
    cancel()
    if (!viewportAdjusted) fitViewport()
    pixelRatio.value = devicePixelRatio || 1
})
watch(elevationBeat, () => {
    if (editorNavigation.value === navigation) {
        cancelMouseControls()
        cancelTouchControls()
    }
    cancel()
    viewportAdjusted = false
    fitViewport()
})
// Focus, hidden groups/stages and type filters change which notes are editable.
// Pure reveals (including authoring revealing its target) never hide a note.
watch([scopeLookup, () => view.visibilities], ([scope, visibilities], [previous, before]) => {
    if (visibilities === before && !isScopeReduced(previous, scope)) return
    cancelMouseControls()
    cancelTouchControls()
    cancel()
})
watch(isAppActive, (active) => {
    if (!active) cancel()
})
watch(
    toolName,
    () => {
        hovered.value = undefined
        cancel()
    },
    { flush: 'sync' },
)
watch(
    state,
    (current, previous) => {
        if (!hasSameChartData(current, previous)) {
            hovered.value = undefined
            creating.value = []
        }
    },
    { flush: 'sync' },
)
watch(editorNavigation, (current) => {
    if (current !== navigation) {
        hovered.value = undefined
        creating.value = []
    }
})

const connectorStore = computed(() => elevationState.value.store.slides.connector)
const connections = computed(() => {
    const rows = elevationLayout.value.rows
    const slideIds = new Set(rows.map((row) => row.note.slideId))
    return getElevationConnections(
        rows,
        [...slideIds].map((id) => connectorStore.value.get(id) ?? []),
        view.visibilities.connector,
        elevationState.value.bpms,
        elevationState.value.store.slides.info,
    )
})

watchEffect(() => {
    const element = canvas.value
    const layout = elevationLayout.value
    const current = elevationState.value
    const currentConnections = connections.value
    const belowNotes = currentConnections.filter(
        (connection) => connection.connector.segmentHead.connectorLayer !== 'over',
    )
    const aboveNotes = currentConnections.filter(
        (connection) => connection.connector.segmentHead.connectorLayer === 'over',
    )
    const selected = new Set(current.selectedEntities)
    const hover = hovered.value
    const ghosts = creating.value.map((row) => ({
        ...row,
        x: layout.xAt(row.lane),
        y: layout.yAt(row.elevation),
        w: row.size * layout.laneScale,
    }))
    const rect = selection.value
    const ratio = pixelRatio.value
    const labels = i18n.value.elevation
    const showGroupName = settings.showGroupName
    const showStageName = settings.showStageName
    const nameContrast = settings.nameContrast
    const elevationSnap = settings.elevationSnap
    // Axis labels move right of any left badges, which would cover them.
    const leftBadges = offscreenGroups.value.filter(({ side }) => side === 'left')
    const axisLabelLeft = leftBadges.length
        ? Math.max(...leftBadges.map(({ count }) => offscreenBadgeHitWidth(count))) + 4
        : undefined
    if (!element || !layout.width || !layout.height || !isAppActive.value) {
        frame.cancel()
        return
    }
    frame.schedule((timestamp) => {
        const w = Math.max(1, Math.round(layout.width * ratio))
        const h = Math.max(1, Math.round(layout.height * ratio))
        if (element.width !== w) element.width = w
        if (element.height !== h) element.height = h
        const ctx = element.getContext('2d')
        if (!ctx) return
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
        ctx.clearRect(0, 0, layout.width, layout.height)
        ctx.font = '12px sans-serif'
        ctx.lineWidth = 1
        const min = layout.elevationCenter - layout.height / 2 / layout.elevationScale
        const max = layout.elevationCenter + layout.height / 2 / layout.elevationScale
        const division = elevationGridDivision(layout.elevationScale, elevationSnap)
        ctx.save()
        ctx.textAlign = axisLabelLeft === undefined ? 'right' : 'left'
        ctx.textBaseline = 'alphabetic'
        const digits = ctx.measureText('0123456789')
        const labelBaseline = (digits.actualBoundingBoxAscent - digits.actualBoundingBoxDescent) / 2
        for (let i = Math.ceil(min * division); i <= Math.floor(max * division); i++) {
            const y = layout.yAt(i / division)
            const label = i % division === 0 ? `${i / division}` : undefined
            ctx.strokeStyle = i === 0 ? '#ffffff80' : i % division === 0 ? '#ffffff40' : '#ffffff0d'
            ctx.beginPath()
            ctx.moveTo(38, y)
            // Inside the grid, the line breaks around its label.
            if (label !== undefined && axisLabelLeft !== undefined) {
                ctx.lineTo(axisLabelLeft - 3, y)
                ctx.moveTo(axisLabelLeft + ctx.measureText(label).width + 3, y)
            }
            ctx.lineTo(layout.width, y)
            ctx.stroke()
            if (label !== undefined) {
                ctx.fillStyle = '#ffffff80'
                ctx.fillText(label, axisLabelLeft ?? 28, y + labelBaseline)
            }
        }
        ctx.restore()
        const laneDivision =
            layout.laneScale / view.laneDivision >= 8 && view.laneDivision <= 32
                ? view.laneDivision
                : 1
        for (
            let i = Math.ceil(layout.laneLeft * laneDivision);
            i <= (layout.laneLeft + layout.width / layout.laneScale) * laneDivision;
            i++
        ) {
            const lane = i / laneDivision
            const x = layout.xAt(lane)
            if (x < 38) continue
            ctx.strokeStyle =
                lane === -6 || lane === 6 ? '#ffffff80' : lane % 2 === 0 ? '#ffffff40' : '#ffffff0d'
            ctx.beginPath()
            ctx.moveTo(x, 52)
            ctx.lineTo(x, layout.height)
            ctx.stroke()
        }
        drawElevationConnections(ctx, belowNotes)
        const names = createNameLayer()
        const context: EditorDrawContext = {
            ctx,
            scale: layout.laneScale,
            pixelRatio: ratio,
            bounds: {
                l: 0,
                r: layout.width / layout.laneScale,
                t: 0,
                b: layout.height / layout.laneScale,
                w: layout.width / layout.laneScale,
                h: layout.height / layout.laneScale,
            },
            ups: 0,
            state: current,
            defaultGroupId: defaultGroupId.value,
            showGroupName,
            showStageName,
            nameContrast,
            recentlyActive: true,
            fontFamily: 'sans-serif',
            fontMiddle: 0.25,
            figureMiddle: 0.35,
            names,
        }
        notes.beginFrame(timestamp)
        const padding = layout.laneScale * 1.6 + 8
        const visibleRows = [...layout.rows, ...ghosts].filter(
            (row) =>
                row.y + padding >= 0 &&
                row.y - padding <= layout.height &&
                row.x + row.w / 2 + padding >= 0 &&
                row.x - row.w / 2 - padding <= layout.width,
        )
        for (const row of visibleRows) {
            ctx.save()
            ctx.scale(layout.laneScale, layout.laneScale)
            notes.draw(
                context,
                row.note,
                selected.has(row.note) || row.note === hover,
                ghosts.includes(row) ? 0.5 : row.attached ? 0.6 : 1,
                {
                    left: (row.x - row.w / 2) / layout.laneScale,
                    y: row.y / layout.laneScale - 0.3,
                    size: row.size,
                },
            )
            ctx.restore()
        }
        drawElevationConnections(ctx, aboveNotes)
        // Names go over every row and connection, as on the chart.
        ctx.save()
        ctx.scale(layout.laneScale, layout.laneScale)
        placeNames(context, names)
        ctx.restore()
        for (const row of visibleRows) {
            if (selected.has(row.note) || row.note === hover) {
                // At least the 0.2-lane placeholder a zero-width note draws.
                const w = Math.max(row.w, layout.laneScale * 0.2)
                ctx.setLineDash([6, 4])
                ctx.strokeStyle = '#ffffff80'
                ctx.strokeRect(
                    row.x - w / 2 - 3,
                    row.y - layout.laneScale * 0.3 - 3,
                    w + 6,
                    layout.laneScale * 0.6 + 6,
                )
                ctx.setLineDash([])
            }
        }
        if (rect) {
            ctx.fillStyle = '#ffffff40'
            ctx.strokeStyle = '#ffffff80'
            ctx.fillRect(rect.x, rect.y, rect.w, rect.h)
            ctx.strokeRect(rect.x, rect.y, rect.w, rect.h)
        }
        if (!layout.rows.length) {
            ctx.fillStyle = '#ffffff80'
            ctx.fillText(labels.empty, 48, 90)
        }
    })
})
onMounted(() => {
    mounted = true
    const updateBounds = () => {
        headerHeight.value = header.value?.clientHeight ?? 80
        const rect = container.value?.getBoundingClientRect()
        if (!rect) return
        Object.assign(elevationBounds, { x: rect.x, y: rect.y, w: rect.width, h: rect.height })
    }
    const observer = new ResizeObserver(() => {
        updateBounds()
        if (!viewportAdjusted) fitViewport()
    })
    if (container.value) observer.observe(container.value)
    if (header.value) observer.observe(header.value)
    window.addEventListener('resize', updateBounds)
    window.addEventListener('scroll', updateBounds, true)
    updateBounds()
    cleanupBounds = () => {
        observer.disconnect()
        window.removeEventListener('resize', updateBounds)
        window.removeEventListener('scroll', updateBounds, true)
    }
    window.addEventListener('keydown', onKeydown, true)
    view.scrollingY = undefined
    view.scrollingX = undefined
    fitViewport()
    panelTools.value = Object.fromEntries(
        (Object.keys(tools) as (keyof typeof tools)[]).map((name) => [
            name,
            {
                ...(elevationToolNames.includes(name) ? tools[name] : tools.select),
                ...controls,
                secondaryTool: undefined,
            },
        ]),
    )
    navigation = {
        bounds: elevationBounds,
        scrollY: (pixels) => {
            viewportAdjusted = true
            closeContextMenu()
            elevationViewport.center += pixels / elevationViewport.scale
        },
        getScaleX: () => elevationLayout.value.laneScale,
        getScaleY: () => elevationViewport.scale,
        setScaleY: (scale) => {
            viewportAdjusted = true
            closeContextMenu()
            elevationViewport.scale = clamp(scale, 1, 1200)
        },
        hitPoint: (x, y, minimum) => {
            const row = hit(x, y, minimum)
            return row ? [row.note] : []
        },
        selectPoint: (x, y) => {
            selectAt(hit(x, y), { ctrl: false, shift: false })
        },
        positionAtPoint,
        pasteAtPoint,
        getContextMenuPoint: () => {
            const layout = elevationLayout.value
            const selected = new Set(state.value.selectedEntities)
            const row = layout.rows.find((row) => selected.has(row.note))
            return {
                x: elevationBounds.x + (row?.x ?? layout.xAt(0)),
                y: elevationBounds.y + (row?.y ?? layout.yAt(elevationViewport.center)),
            }
        },
    }
    activate()
})
let cleanupBounds: (() => void) | undefined
onUnmounted(() => {
    mounted = false
    cleanupBounds?.()
    window.removeEventListener('keydown', onKeydown, true)
    cancel()
    frame.cancel()
    notes.clear()
    panelTools.value = {}
    if (editorNavigation.value === navigation) editorNavigation.value = undefined
    view.scrollingX = undefined
    view.scrollingY = undefined
    view.entities = { hovered: [], creating: [] }
})
</script>

<template>
    <section
        ref="container"
        class="elevation-editor chart-pane absolute size-full"
        tabindex="-1"
        @pointerenter="activate"
        @focusin="activate"
        @pointerdown="container?.focus()"
        @keydown="onKeydown"
    >
        <div
            class="editor absolute size-full touch-none"
            :style="{ cursor }"
            v-on="controlListeners"
        >
            <canvas
                ref="canvas"
                class="elevation-canvas pointer-events-none absolute size-full"
                :aria-label="i18n.elevation.canvas"
            />
            <OffscreenNoteIndicators :groups="offscreenGroups" :hovered="hoveredOffscreenGroup" />
        </div>
        <!-- Beside the main editor, notifications show in its pane instead. -->
        <LevelEditorNotification
            v-if="!isElevationSideBySide"
            pane="elevation"
            :inset="headerHeight"
        />
        <LevelEditorToolbar
            v-if="!hasToolModal('elevation')"
            pane="elevation"
            :available="availableCommands"
        />
        <EditorToolModalHost pane="elevation" />
        <div
            ref="header"
            :[dockKeysAttribute]="''"
            class="elevation-header absolute inset-x-0 top-0 isolate border-b border-white/10 bg-preview text-sm text-white/80"
            @click="blurAfterPointer"
        >
            <div class="elevation-header-layout px-4">
                <span
                    class="elevation-title min-w-0 truncate font-medium text-white"
                    :title="i18n.elevation.header"
                    >{{ i18n.elevation.header }}</span
                >
                <div class="elevation-controls">
                    <div class="elevation-beat">
                        <button
                            type="button"
                            :class="headerIconButton"
                            :aria-label="i18n.elevation.previousBeat"
                            :title="i18n.elevation.previousBeat"
                            :disabled="previousBeat === undefined"
                            @click="previousBeat !== undefined && changeBeat(previousBeat)"
                        >
                            <ChevronIcon direction="left" />
                        </button>
                        <label class="elevation-beat-field"
                            ><span class="elevation-label">{{ i18n.elevation.beat }}</span
                            ><input
                                ref="beatInput"
                                v-model.lazy="beatField"
                                :class="headerField"
                                class="focus:ring-2"
                                type="number"
                                min="1"
                                :step="1 / view.division"
                                :aria-label="i18n.elevation.beat"
                                @change="resyncInput($event, () => `${beatField}`)"
                                @keydown.esc="revertOnEscape($event, `${beatField}`)"
                                @keydown.enter="confirmOnEnter"
                        /></label>
                        <button
                            type="button"
                            :class="headerIconButton"
                            :aria-label="i18n.elevation.nextBeat"
                            :title="i18n.elevation.nextBeat"
                            :disabled="nextBeat === undefined"
                            @click="nextBeat !== undefined && changeBeat(nextBeat)"
                        >
                            <ChevronIcon direction="right" />
                        </button>
                    </div>
                    <label class="elevation-snap"
                        ><span class="elevation-label">{{ i18n.elevation.snap }}</span
                        ><span class="elevation-select group"
                            ><select
                                v-model="settings.elevationSnap"
                                :title="
                                    settings.elevationSnap
                                        ? `1/${settings.elevationSnap}`
                                        : i18n.elevation.off
                                "
                                :class="headerField"
                                class="cursor-pointer focus-visible:ring-2"
                                :aria-label="i18n.elevation.snapping"
                            >
                                <option :value="0">{{ i18n.elevation.off }}</option>
                                <option
                                    v-for="division in [1, 2, 4, 8, 16, 32, 64]"
                                    :key="division"
                                    :value="division"
                                >
                                    1/{{ division }}
                                </option></select
                            ><SelectValue
                                :value="
                                    settings.elevationSnap
                                        ? `1/${settings.elevationSnap}`
                                        : i18n.elevation.off
                                "
                                class="z-[2] px-3 text-base tabular-nums text-fg group-active:text-on-accent" /><span
                                class="elevation-select-icon group-active:text-on-accent"
                                aria-hidden="true"
                                ><ChevronIcon direction="down" /></span></span
                    ></label>
                </div>
                <button
                    type="button"
                    class="elevation-close"
                    :class="headerIconButton"
                    :aria-label="i18n.elevation.close"
                    :title="i18n.elevation.close"
                    @click="closeElevationEditor"
                >
                    <CloseIcon class="size-4" />
                </button>
            </div>
        </div>
    </section>
</template>

<style scoped>
/*
 * The header is workspace chrome over the canvas. Its layout follows its own
 * width; the canvas top margin is measured from the rendered header.
 * - Wide: the title, controls and close share one 32px row.
 * - Default: a title row, then one row of controls.
 * - Narrow: labels and fields in aligned grid columns.
 * - Narrowest: labels above their fields.
 */
.elevation-header {
    container-type: inline-size;
}

.elevation-header-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas:
        'title close'
        'controls controls';
    align-items: center;
    column-gap: 0.75rem;
    /* Two rows stay as short as the header was before 32px fields. */
    row-gap: 0.25rem;
    padding-block: 0.375rem;
}

.elevation-title {
    grid-area: title;
}

/* The title row stays one text line tall, and the glyph sits on the 16px gutter. */
.elevation-close {
    grid-area: close;
    margin-block: -0.375rem;
    margin-right: -0.5rem;
}

.elevation-controls {
    grid-area: controls;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    column-gap: 1rem;
    row-gap: 0.5rem;
}

/* The previous-beat glyph lines up with the title. */
.elevation-beat {
    display: flex;
    align-items: center;
    margin-left: -0.5rem;
}

.elevation-beat-field,
.elevation-snap {
    display: flex;
    align-items: center;
    gap: 0.5rem;
}

.elevation-label {
    white-space: nowrap;
}

/* A field's own box wins over the hit area of the stepper beside it. */
.elevation-field {
    position: relative;
    z-index: 1;
}

/* Spinners are hidden (D8); arrow keys and the wheel still step. */
.elevation-field[type='number'] {
    -moz-appearance: textfield;
    appearance: textfield;
}

.elevation-field::-webkit-inner-spin-button,
.elevation-field::-webkit-outer-spin-button {
    appearance: none;
    margin: 0;
}

@container (min-width: 35rem) {
    .elevation-header-layout {
        grid-template-columns: minmax(0, max-content) minmax(max-content, 1fr) auto;
        grid-template-areas: 'title controls close';
        column-gap: 1rem;
        padding-block: 0.5rem;
    }

    .elevation-close {
        margin-block: 0;
    }

    .elevation-controls {
        flex-wrap: nowrap;
    }

    .elevation-beat {
        margin-left: 0;
    }
}

/* Each field is sized for its values rather than squeezed to keep one row: the
   beat holds values such as 123.0625, and snapping at most "1/64". Narrow
   headers wrap the snap field onto its own row instead. */
.elevation-beat-field .elevation-field {
    width: 6rem;
}

.elevation-snap .elevation-field {
    width: 5rem;
    padding-right: 1.75rem;
}

/* A select carries a trailing chevron inside its pill, as form fields do. */
.elevation-select {
    position: relative;
    display: flex;
    min-width: 0;
}

.elevation-select-icon {
    pointer-events: none;
    position: absolute;
    inset-block: 0;
    right: 0.75rem;
    z-index: 2;
    display: flex;
    align-items: center;
    color: theme('colors.fg');
}

@container (max-width: 19rem) {
    .elevation-controls {
        display: grid;
        grid-template-columns: 2rem minmax(0, max-content) minmax(0, 1fr) 2rem;
        margin-inline: -0.5rem;
        column-gap: 0;
    }

    .elevation-beat,
    .elevation-beat-field,
    .elevation-snap {
        display: contents;
    }

    .elevation-label {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        padding-right: 0.5rem;
    }

    .elevation-snap .elevation-label {
        grid-column: 2;
    }

    /* The next-beat button sits right below the close button here. */
    .elevation-close::before {
        bottom: 0;
    }

    .elevation-controls .elevation-field {
        width: 100%;
    }
}

@container (max-width: 12rem) {
    /* Labels stack above their fields within the header's former height. */
    .elevation-controls {
        grid-template-columns: 2rem minmax(0, 1fr) 2rem;
        row-gap: 0.25rem;
    }

    .elevation-beat-field,
    .elevation-snap {
        display: flex;
        grid-column: 2;
        flex-direction: column;
        align-items: stretch;
        gap: 0;
    }

    .elevation-label {
        padding-right: 0;
    }

    .elevation-beat > button {
        align-self: end;
    }
}
</style>
