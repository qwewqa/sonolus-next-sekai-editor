const formerSelection = [
    'increaseNoteSize',
    'decreaseNoteSize',
    'brush',
    'eraser',
    'deselect',
    'elevation',
    'select',
]

export const migrateToolbar = (groups: unknown[][]) => {
    if (
        !groups.some(
            (group) =>
                group.length === formerSelection.length &&
                group.every((name, index) => name === formerSelection[index]),
        )
    )
        return groups
    const result = groups.map((group) => [...group])
    const selection = result.find(
        (group) =>
            group.length === formerSelection.length &&
            group.every((name, index) => name === formerSelection[index]),
    )
    if (selection) selection.splice(selection.indexOf('elevation'), 1)
    const zooms = result.find(
        (group) =>
            group.length === 4 &&
            ['zoomXIn', 'zoomXOut', 'zoomYIn', 'zoomYOut'].every(
                (name, index) => name === group[index],
            ),
    )
    if (zooms) zooms.push('elevation')
    else result.push(['elevation'])
    if (
        !result.some((group) =>
            group.some((name) => typeof name === 'string' && name.startsWith('laneLimit')),
        )
    ) {
        const index = result.findIndex((group) => group.includes('laneDivisionCustom'))
        result.splice(index === -1 ? result.length : index + 1, 0, [
            'laneLimitCustom',
            'laneLimitSix',
            'laneLimitNone',
        ])
    }
    return result
}
