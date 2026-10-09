const formerSelection = [
    'increaseNoteSize',
    'decreaseNoteSize',
    'brush',
    'eraser',
    'deselect',
    'elevation',
    'select',
]

const formerView = ['zoomXIn', 'zoomXOut', 'zoomYIn', 'zoomYOut', 'elevation']
const formerTransforms = [
    'elevation',
    'scaleWidth',
    'scaleElevation',
    'scaleBeat',
    'makeVertical',
    'combineNotes',
    'splitHold',
    'flipVertical',
    'flip',
]
const matches = (group: unknown[], names: string[]) =>
    group.length === names.length && group.every((name, index) => name === names[index])

export const migrateToolbar = (groups: unknown[][], addEditorLayout = true) => {
    const migrated = migrateElevation(groups)
    if (!addEditorLayout) return migrated
    // Add the new mode only to the previous default group; customized groups stay intact.
    if (migrated.some((group) => group.includes('editorLayout'))) return migrated
    const index = migrated.findIndex((group) => matches(group, formerTransforms))
    if (index === -1) return migrated
    return migrated.map((group, i) => (i === index ? ['editorLayout', ...group] : group))
}

const migrateElevation = (groups: unknown[][]) => {
    const sourceIndex = groups.findIndex(
        (group) => matches(group, formerSelection) || matches(group, formerView),
    )
    if (sourceIndex === -1) return groups
    const result = groups.map((group) => [...group])
    const source = result[sourceIndex]
    if (source) source.splice(source.indexOf('elevation'), 1)
    if (!result.some((group) => group.includes('elevation'))) {
        const transforms = result.find(
            (group) => group.includes('scaleWidth') && group.includes('flip'),
        )
        if (transforms) transforms.unshift('elevation')
        else result.push(['elevation'])
    }
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
