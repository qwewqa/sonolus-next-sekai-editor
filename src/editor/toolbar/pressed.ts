import { settings } from '../../settings'
import { commands, type CommandName } from '../commands'
import { isElevationEditorOpen } from '../elevation/state'
import { toolName, tools, type ToolName } from '../tools'
import { defaultNotePropertiesPresetIndex } from '../tools/note'
import { defaultSlidePropertiesPresetIndex } from '../tools/slide'
import { view } from '../view'

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

const divisionOf = (axis: string) => (axis === 'division' ? view.division : view.laneDivision)

const laneLimits: Partial<Record<CommandName, number>> = { laneLimitNone: 0, laneLimitSix: 6 }

/** Whether a tool, mode or value is in use; undefined for plain actions, which are not toggles. */
export const isCommandPressed = (name: CommandName): boolean | undefined => {
    if (name === 'elevation') return isElevationEditorOpen.value
    if (name === 'event') return eventTools.includes(toolName.value)

    const preset = /^(note|slide)(\d+)$/.exec(name)
    if (preset) {
        const tool = preset[1] as keyof typeof presetIndices
        return toolName.value === tool && presetIndices[tool].value === Number(preset[2])
    }

    // A preset is pressed while its value is in use, and Custom while no preset's is.
    const division = /^(division|laneDivision)(\d+|Custom)$/.exec(name)
    if (division) {
        const [, axis = '', member] = division
        const value = divisionOf(axis)
        return member === 'Custom' ? !(`${axis}${value}` in commands) : Number(member) === value
    }
    if (name in laneLimits) return settings.maxLane === laneLimits[name]
    if (name === 'laneLimitCustom') return !Object.values(laneLimits).includes(settings.maxLane)

    return name in tools ? toolName.value === name : undefined
}

/** Icon props for a pressed Custom member, which shows the value in use. */
export const pressedIconProps = (name: CommandName): object | undefined => {
    if (name === 'divisionCustom' || name === 'laneDivisionCustom') {
        const title = `1/${divisionOf(name === 'divisionCustom' ? 'division' : 'laneDivision')}`
        // Only as wide as the widest preset, 1/16.
        return title.length <= 4 ? { title } : undefined
    }
    if (name === 'laneLimitCustom') return { mode: 'custom', value: settings.maxLane }
}
