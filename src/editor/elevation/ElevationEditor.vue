<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, useTemplateRef, watch, watchEffect } from 'vue'
import { isAppActive } from '../../activity'
import { clipboardEntry, updateClipboard } from '../../clipboard'
import { pushState, replaceState, state } from '../../history'
import { defaultGroupId } from '../../history/groups'
import { i18n } from '../../i18n'
import { modals, showModal } from '../../modals'
import { clearPreviewEdit, setPreviewEdit } from '../../preview/edit'
import { settings } from '../../settings'
import type { State } from '../../state'
import { hasSameChartData } from '../../state/data'
import type { NoteEntity } from '../../state/entities/slides/note'
import { beatToTime } from '../../state/integrals/bpms'
import { editSelectedNote } from '../../state/operations/note'
import { createTransaction } from '../../state/transaction'
import { align, clamp } from '../../utils/math'
import { createNoteRenderer } from '../canvas/notes'
import { createFrameScheduler } from '../canvas/surface'
import type { EditorDrawContext } from '../canvas/types'
import { activateEditorNavigation, controlsForNavigation } from '../controls'
import { cancelMouseControls } from '../controls/mouse'
import { cancelTouchControls } from '../controls/touch'
import type { Modifiers } from '../controls/gestures/pointer'
import { editorNavigation, type EditorNavigation } from '../navigation'
import { closeContextMenu, contextMenu } from '../contextMenu'
import { isSidebarVisible } from '../sidebars'
import { panelTools, tools, toolName, type Tool } from '../tools'
import { applyBrushToEntities } from '../tools/brush'
import { remove } from '../tools/eraser'
import { applyGeneratedSlideNotes } from '../tools/generateSlideNotes'
import { defaultNoteProperties } from '../tools/note'
import NotePropertiesModal from '../tools/note/NotePropertiesModal.vue'
import { defaultSlideProperties } from '../tools/slide'
import SlidePropertiesModal from '../tools/slide/SlidePropertiesModal.vue'
import { quickEdit } from '../utils/quickEdit'
import LevelEditorToolbar from '../toolbar/LevelEditorToolbar.vue'
import type { CommandName } from '../commands'
import { isNoteResizeStart, modifyEntities, offset, resize } from '../tools/utils'
import { view, focusViewAtBeat } from '../view'
import { snapElevation, sameBeat, type ElevationNote, type ElevationRow } from './layout'
import {
    createElevationNote,
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

const canvas = useTemplateRef<HTMLCanvasElement>('canvas')
const container = useTemplateRef<HTMLElement>('container')
const header = useTemplateRef<HTMLDivElement>('header')
let navigation: EditorNavigation | undefined
const controlListeners = controlsForNavigation(() => navigation)
const activate = () => {
    if (navigation) activateEditorNavigation(navigation)
}
const xToLane = (x: number) =>
    elevationLayout.value.laneLeft + (x - elevationBounds.x) / elevationLayout.value.laneScale
const availableCommands: CommandName[] = [
    'select',
    'elevation',
    'deselect',
    'eraser',
    'brush',
    'paste',
    'cut',
    'copy',
    'undo',
    'redo',
    'flip',
    'combineNotes',
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
    'groupAll',
    'groupNext',
    'groupPrev',
    'stageAll',
    'stageNext',
    'stagePrev',
    'noteVisibility',
    'snapping',
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
            +state.value.selectedEntities.includes(b.note) -
                +state.value.selectedEntities.includes(a.note) ||
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
const edit = (active: NonNullable<typeof drag>) => {
    const transaction = createTransaction(active.source, { autoAddGroup: false })
    const replacements = new Map(
        active.targets.flatMap((note) => {
            const [left, size] = active.resizing
                ? resize(active.anchor, active.movingEdge + active.deltaLane)
                : [note.left + active.deltaLane, note.size]
            const replacement = editSelectedNote(transaction, note, {
                left,
                size,
                elevation: note.elevation + active.deltaElevation,
            })[0]
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
    const { groupId, stageId } = view
    try {
        await updateClipboard()
    } catch {
        if (!clipboardEntry.value?.data) return false
    }
    if (
        !mounted ||
        !isElevationEditorOpen.value ||
        !hasSameChartData(source, state.value) ||
        view.groupId !== groupId ||
        view.stageId !== stageId ||
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
const controls: Pick<
    Tool,
    'hover' | 'tap' | 'dragStart' | 'dragUpdate' | 'dragEnd' | 'dragCancel'
> = {
    hover(x, y, modifiers) {
        hovered.value = hit(x, y, 0.5)?.note
        const position = positionAtPoint(x, y)
        if (!hovered.value && (toolName.value === 'note' || toolName.value === 'slide'))
            creating.value = ghostRows([
                previewElevationNote(
                    align(position.lane),
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
                    align(position.lane),
                    position.elevation,
                    position.beat,
                    toolName.value === 'slide',
                )
                creating.value = []
                return
            }
            if (!modifiers.ctrl && state.value.selectedEntities.includes(row.note)) {
                if (isSidebarVisible.value)
                    quickEdit(
                        toolName.value === 'slide'
                            ? defaultSlideProperties.value
                            : defaultNoteProperties.value,
                    )
                else
                    void showModal(
                        toolName.value === 'slide' ? SlidePropertiesModal : NotePropertiesModal,
                        {},
                    )
                return
            }
        }
        selectAt(row, modifiers)
    },
    dragStart(x, y, modifiers) {
        const row = hit(x, y)
        if (toolName.value === 'paste') return true
        if (!row && (toolName.value === 'note' || toolName.value === 'slide')) {
            const position = positionAtPoint(x, y)
            adding = {
                lane: align(position.lane),
                elevation: position.elevation,
                slide: toolName.value === 'slide',
            }
            return true
        }
        if (!row || ['eraser', 'brush', 'generateSlideNotes'].includes(toolName.value)) {
            marquee = {
                x: x - elevationBounds.x,
                y: y - elevationBounds.y,
                selected: state.value.selectedEntities,
            }
            return true
        }
        if (!state.value.selectedEntities.includes(row.note)) selectAt(row, modifiers)
        if (row.attached) return false
        const eligible = new Set(
            elevationNotes.value.filter((item) => !item.attached).map((item) => item.note),
        )
        const resizing = isNoteResizeStart(
            { left: row.lane - row.size / 2, size: row.size },
            xToLane(x),
        )
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
            anchor: xToLane(x) < row.lane ? row.note.left + row.note.size : row.note.left,
            movingEdge: xToLane(x) < row.lane ? row.note.left : row.note.left + row.note.size,
        }
        return true
    },
    dragUpdate(x, y, modifiers) {
        if (adding) {
            const [left, size] = resize(adding.lane, xToLane(x), 1)
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
        const deltaLane = drag.resizing
            ? align(xToLane(x) - drag.lane)
            : offset(drag.lane, xToLane(x))
        const delta = yToElevation(y) - drag.elevation
        const deltaElevation = drag.resizing
            ? 0
            : view.snapping === 'relative'
              ? snapElevation(delta, settings.elevationSnap)
              : snapElevation(drag.row.elevation + delta, settings.elevationSnap) -
                drag.row.elevation
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
            const [left, size] = resize(current.lane, xToLane(x), 1)
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
        if (active && (active.deltaLane || active.deltaElevation))
            pushState(() => i18n.value.elevation.history, edit(active))
    },
    dragCancel: cancel,
}

const committedNotes = computed(() => state.value.store.slides.note)
const visibleBeats = computed(() =>
    [
        ...new Set(
            [...committedNotes.value.values()].flatMap((slide) =>
                slide
                    .filter(
                        (note) =>
                            view.visibilities.note &&
                            (view.groupId === undefined || note.groupId === view.groupId) &&
                            (view.stageId === undefined || note.stageId === view.stageId),
                    )
                    .map((note) => note.beat),
            ),
        ),
    ].sort((a, b) => a - b),
)
const previousBeat = computed(() =>
    visibleBeats.value.filter((beat) => beat < elevationBeat.value - 1e-7).pop(),
)
const nextBeat = computed(() =>
    visibleBeats.value.find((beat) => beat > elevationBeat.value + 1e-7),
)
const changeBeat = (beat: number) => {
    if (!Number.isFinite(beat)) return
    cancelMouseControls()
    cancelTouchControls()
    cancel()
    elevationBeat.value = Math.max(0, beat)
    if (isElevationSideBySide.value) focusViewAtBeat(elevationBeat.value)
    else view.cursorTime = beatToTime(state.value.bpms, elevationBeat.value)
    fitViewport()
}
const onBeatInput = (event: Event) => {
    changeBeat(Number((event.target as HTMLInputElement).value))
}
const onKeydown = (event: KeyboardEvent) => {
    if (modals.length) return
    if (editorNavigation.value !== navigation) return
    if (event.key !== 'Escape') return
    if (event.target instanceof Element && event.target.closest('[role=separator]')) return
    event.preventDefault()
    event.stopPropagation()
    if (contextMenu.value) {
        closeContextMenu()
        return
    }
    if (drag || marquee || adding) {
        cancelMouseControls()
        cancelTouchControls()
        cancel()
    } else if (!isElevationSideBySide.value) closeElevationEditor()
    else selectAt(undefined, { ctrl: false, shift: false })
}
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
watch([() => view.groupId, () => view.stageId, () => view.visibilities], () => {
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
        const division = layout.elevationScale >= 60 ? 8 : layout.elevationScale >= 30 ? 4 : 1
        for (let i = Math.ceil(min * division); i <= Math.floor(max * division); i++) {
            const y = layout.yAt(i / division)
            ctx.strokeStyle = i === 0 ? '#ffffff80' : i % division === 0 ? '#ffffff40' : '#ffffff0d'
            ctx.beginPath()
            ctx.moveTo(38, y)
            ctx.lineTo(layout.width, y)
            ctx.stroke()
            if (i % division === 0) {
                ctx.fillStyle = '#ffffff80'
                ctx.fillText(`${i / division}`, 12, y + 4)
            }
        }
        for (
            let lane = Math.ceil(layout.laneLeft);
            lane <= layout.laneLeft + layout.width / layout.laneScale;
            lane++
        ) {
            const x = layout.xAt(lane)
            ctx.strokeStyle =
                lane === -6 || lane === 6 ? '#ffffff80' : lane % 2 === 0 ? '#ffffff40' : '#ffffff0d'
            ctx.beginPath()
            ctx.moveTo(x, 52)
            ctx.lineTo(x, layout.height)
            ctx.stroke()
        }
        drawElevationConnections(ctx, belowNotes)
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
            recentlyActive: true,
            fontFamily: 'sans-serif',
            fontMiddle: 0.25,
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
        for (const row of visibleRows) {
            if (selected.has(row.note) || row.note === hover) {
                ctx.setLineDash([6, 4])
                ctx.strokeStyle = '#ffffff80'
                ctx.strokeRect(
                    row.x - row.w / 2 - 3,
                    row.y - layout.laneScale * 0.3 - 3,
                    row.w + 6,
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
        class="elevation-editor absolute size-full"
        tabindex="-1"
        @pointerenter="activate"
        @focusin="activate"
        @pointerdown="container?.focus()"
        @keydown="onKeydown"
    >
        <div class="editor absolute size-full touch-none" v-on="controlListeners">
            <canvas
                ref="canvas"
                class="elevation-canvas pointer-events-none absolute size-full"
                :aria-label="i18n.elevation.canvas"
            />
        </div>
        <LevelEditorToolbar :available="availableCommands" />
        <div
            ref="header"
            class="elevation-header absolute inset-x-0 top-0 flex flex-col gap-2 border-b border-white/10 bg-preview px-3 py-2 text-xs text-white/75"
            @keydown.stop
        >
            <div class="relative flex flex-wrap items-center gap-x-3 gap-y-2 pr-8">
                <strong class="flex-grow text-white/90" :title="i18n.elevation.header">{{
                    i18n.elevation.header
                }}</strong>
                <button
                    class="absolute -right-1 -top-1 flex size-8 items-center justify-center rounded text-lg leading-none hover:bg-white/10"
                    :aria-label="i18n.elevation.close"
                    :title="i18n.elevation.close"
                    @click="closeElevationEditor"
                >
                    ×
                </button>
            </div>
            <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
                <div class="flex items-center gap-2">
                    <button
                        class="rounded px-2 py-1 hover:bg-white/10 disabled:opacity-25"
                        aria-label="Previous beat"
                        title="Previous beat"
                        :disabled="previousBeat === undefined"
                        @click="previousBeat !== undefined && changeBeat(previousBeat)"
                    >
                        ‹
                    </button>
                    <label class="flex items-center gap-2"
                        >{{ i18n.elevation.beat
                        }}<input
                            class="w-16 rounded border border-white/10 bg-bg px-2 py-1 text-white"
                            type="number"
                            min="0"
                            :step="1 / view.division"
                            :value="elevationBeat"
                            :aria-label="i18n.elevation.beat"
                            @change="onBeatInput"
                    /></label>
                    <button
                        class="rounded px-2 py-1 hover:bg-white/10 disabled:opacity-25"
                        aria-label="Next beat"
                        title="Next beat"
                        :disabled="nextBeat === undefined"
                        @click="nextBeat !== undefined && changeBeat(nextBeat)"
                    >
                        ›
                    </button>
                </div>
                <label class="flex items-center gap-2"
                    >{{ i18n.elevation.snap
                    }}<select
                        v-model="settings.elevationSnap"
                        class="rounded border border-white/10 bg-bg px-2 py-1 text-white"
                        aria-label="Elevation snapping"
                    >
                        <option :value="0">{{ i18n.elevation.off }}</option>
                        <option
                            v-for="division in [1, 2, 4, 8, 16, 32, 64]"
                            :key="division"
                            :value="division"
                        >
                            1/{{ division }}
                        </option>
                    </select></label
                >
            </div>
        </div>
    </section>
</template>
