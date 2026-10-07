import { settings } from '../../settings'
import { type CommandName } from '../commands'
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

// A value preset's family, and whether its value is in use.
const valuePreset = (name: CommandName) => {
    const division = /^(division|laneDivision)(\d+)$/.exec(name)
    if (division) {
        const [, family = '', value] = division
        return { family, current: Number(value) === divisionOf(family) }
    }
    const limit = laneLimits[name]
    if (limit !== undefined) return { family: 'laneLimit', current: settings.maxLane === limit }
}

/**
 * Whether a tool, mode or value is in use; undefined for plain actions, which
 * are not toggles. Custom is in use while no preset in its toolbar group is.
 */
export const isCommandPressed = (
    name: CommandName,
    group: readonly CommandName[],
): boolean | undefined => {
    if (name === 'elevation') return isElevationEditorOpen.value
    if (name === 'event') return eventTools.includes(toolName.value)

    const preset = /^(note|slide)(\d+)$/.exec(name)
    if (preset) {
        const tool = preset[1] as keyof typeof presetIndices
        return toolName.value === tool && presetIndices[tool].value === Number(preset[2])
    }

    const value = valuePreset(name)
    if (value) return value.current
    const custom = /^(division|laneDivision|laneLimit)Custom$/.exec(name)
    if (custom)
        return !group.some((other) => {
            const value = valuePreset(other)
            return !!value && value.family === custom[1] && value.current
        })

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
