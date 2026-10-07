import { computed, shallowRef, type Component } from 'vue'
import { isToolModalOpen } from '../../modals'
import { scalingSession } from '../commands/scaleSelection/session'
import type { CanvasCursor } from '../controls/cursor'
import type { Modifiers } from '../controls/gestures/pointer'
import { editorNavigation } from '../navigation'
import { scalingTool } from '../scaling/tool'
import { view } from '../view'
import { bpm } from './bpm'
import { brush } from './brush'
import { elevation } from './elevation'
import { eraser } from './eraser'
import { cameraEvent } from './events/camera'
import { stageMaskEvent } from './events/stage/mask'
import { stagePivotEvent } from './events/stage/pivot'
import { stageStyleEvent } from './events/stage/style'
import { stageTransformEvent } from './events/stage/transform'
import { generateSlideNotes } from './generateSlideNotes'
import { note } from './note'
import { offset } from './offset'
import { clearPasteGhost, paste } from './paste'
import { select } from './select'
import { slide } from './slide'
import { toolName } from './state'
import { timeScale } from './timeScale'

export type Tool = {
    title: () => string
    sidebar?: Component
    secondaryTool?: false

    hover?: (x: number, y: number, modifiers: Modifiers) => void | Promise<void>

    tap?: (x: number, y: number, modifiers: Modifiers) => void | Promise<void>

    // Pure; must share dragStart's resolver so it shows what a press here does.
    cursor?: (x: number, y: number) => CanvasCursor

    dragStart?: (x: number, y: number, modifiers: Modifiers) => boolean
    dragUpdate?: (x: number, y: number, modifiers: Modifiers) => void
    dragEnd?: (x: number, y: number, modifiers: Modifiers) => void | Promise<void>
    dragCancel?: () => void
}

export const tools = {
    select,
    elevation,
    eraser,
    brush,
    paste,

    note,
    slide,
    generateSlideNotes,

    bpm,
    timeScale,

    cameraEvent,
    stageMaskEvent,
    stagePivotEvent,
    stageStyleEvent,
    stageTransformEvent,

    offset,
}

export type ToolName = keyof typeof tools

export { toolName } from './state'

export const panelTools = shallowRef<Partial<Record<ToolName, Tool>>>({})

const normalTool = computed(() =>
    editorNavigation.value
        ? (panelTools.value[toolName.value] ?? tools[toolName.value])
        : toolName.value === 'elevation'
          ? tools.select
          : tools[toolName.value],
)

const inspectingTool: Tool = {
    title: () => normalTool.value.title(),
    get sidebar() {
        return normalTool.value.sidebar
    },
    secondaryTool: false,
}

export const tool = computed(() =>
    scalingSession.value ? scalingTool : isToolModalOpen.value ? inspectingTool : normalTool.value,
)

export const switchToolTo = (tool: ToolName) => {
    toolName.value = tool

    view.entities = {
        hovered: [],
        creating: [],
    }
    clearPasteGhost()
}
