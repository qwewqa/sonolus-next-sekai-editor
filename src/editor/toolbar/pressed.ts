import type { CommandName } from '../commands'
import { isElevationEditorOpen } from '../elevation/state'
import { toolName, tools, type ToolName } from '../tools'
import { defaultNotePropertiesPresetIndex } from '../tools/note'
import { defaultSlidePropertiesPresetIndex } from '../tools/slide'

const eventTools: readonly ToolName[] = [
    'cameraEvent',
    'stageMaskEvent',
    'stagePivotEvent',
    'stageStyleEvent',
    'stageTransformEvent',
]

const presetIndices = {
    note: defaultNotePropertiesPresetIndex,
    slide: defaultSlidePropertiesPresetIndex,
}

/** Whether a command's tool or mode is the one in use, shown as pressed. */
export const isCommandPressed = (name: CommandName) => {
    if (name === 'elevation') return isElevationEditorOpen.value
    if (name === 'event') return eventTools.includes(toolName.value)

    const preset = /^(note|slide)(\d+)$/.exec(name)
    if (preset) {
        const tool = preset[1] as keyof typeof presetIndices
        return toolName.value === tool && presetIndices[tool].value === Number(preset[2])
    }

    return name in tools && toolName.value === name
}
