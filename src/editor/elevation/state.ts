import { ref, watch } from 'vue'
import { bpms } from '../../history/bpms'
import { selectedEntities } from '../../history/selectedEntities'
import { beatToTime, timeToBeat } from '../../state/integrals/bpms'
import { editorNavigation } from '../navigation'
import { switchToolTo, toolName, type ToolName } from '../tools'
import { view } from '../view'

export const elevationBeat = ref(0)
export const isElevationEditorOpen = ref(false)
export const isElevationSideBySide = ref(false)

export const elevationToolNames: readonly ToolName[] = [
    'select',
    'elevation',
    'note',
    'slide',
    'eraser',
    'brush',
    'paste',
    'generateSlideNotes',
]

let previousTool: ToolName = 'select'

export const openElevationEditor = (beat?: number) => {
    if (isElevationEditorOpen.value && beat === undefined) return

    if (!isElevationEditorOpen.value) previousTool = toolName.value
    const note = selectedEntities.value.filter((entity) => entity.type === 'note').pop()
    const displayedBeat = beat ?? note?.beat ?? timeToBeat(bpms.value, Math.max(0, view.cursorTime))
    isElevationEditorOpen.value = true
    view.cursorTime = beatToTime(bpms.value, displayedBeat)
    elevationBeat.value = displayedBeat
    switchToolTo('elevation')
}

export const closeElevationEditor = () => {
    isElevationEditorOpen.value = false
    if (toolName.value === 'elevation') switchToolTo(previousTool)
}

watch(
    toolName,
    (name) => {
        if (
            isElevationEditorOpen.value &&
            !isElevationSideBySide.value &&
            !elevationToolNames.includes(name)
        )
            isElevationEditorOpen.value = false
    },
    { flush: 'sync' },
)

watch(
    () => view.cursorTime,
    (time) => {
        if (isElevationEditorOpen.value)
            elevationBeat.value = timeToBeat(bpms.value, Math.max(0, time))
    },
    { flush: 'sync' },
)

let stopFollowingSelection: (() => void) | undefined

watch(
    isElevationEditorOpen,
    (open) => {
        stopFollowingSelection?.()
        stopFollowingSelection = undefined
        if (!open) return
        stopFollowingSelection = watch(
            selectedEntities,
            (selection, previousSelection) => {
                if (!isElevationSideBySide.value || editorNavigation.value) return
                const notes = selection.filter((entity) => entity.type === 'note')
                const note = notes[0]
                if (
                    !note ||
                    notes.some((other) => other.beat !== note.beat) ||
                    !notes.some((other) => !previousSelection.includes(other))
                )
                    return
                view.cursorTime = beatToTime(bpms.value, note.beat)
                elevationBeat.value = note.beat
            },
            { flush: 'sync' },
        )
    },
    { flush: 'sync' },
)
