import { expect, test } from '@playwright/test'
import type { GroupId } from '../../src/chart/groups'
import type { TimeScaleObject } from '../../src/chart/timeScale'
import type { EntityType } from '../../src/state/entities'
import type { EditableObject } from '../../src/state/operations/editable'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

const cases: {
    name: string
    type: EntityType
    beat: number
    object: EditableObject
}[] = [
    { name: 'initial BPM move', type: 'bpm', beat: 0, object: { beat: 2 } },
    { name: 'initial BPM overlap', type: 'bpm', beat: 0, object: { beat: 4 } },
    { name: 'BPM move to zero', type: 'bpm', beat: 4, object: { beat: 0, bpm: 90 } },
    { name: 'BPM value', type: 'bpm', beat: 0, object: { bpm: 90 } },
    { name: 'time scale overlap', type: 'timeScale', beat: 2, object: { beat: 4 } },
    {
        name: 'time scale group at same beat',
        type: 'timeScale',
        beat: 4,
        object: { groupId: 2 as GroupId },
    },
    {
        name: 'time scale target group',
        type: 'timeScale',
        beat: 2,
        object: { beat: 4, groupId: 2 as GroupId, timeScale: 0, hideNotes: false },
    },
    {
        name: 'time scale unspecified fields',
        type: 'timeScale',
        beat: 2,
        object: { editorLane: 0, timeScale: undefined, hideNotes: undefined },
    },
    {
        name: 'note connector defaults',
        type: 'note',
        beat: 3,
        object: { isCritical: true, isFake: true },
    },
    { name: 'camera event', type: 'cameraEventJoint', beat: 2, object: { cameraZoom: 2, beat: 3 } },
    {
        name: 'stage mask',
        type: 'stageMaskEventJoint',
        beat: 2.5,
        object: { maskLeft: 0, isMaskNotes: false },
    },
    {
        name: 'stage pivot',
        type: 'stagePivotEventJoint',
        beat: 3,
        object: { pivotLane: 0, divisionSize: 4 },
    },
    {
        name: 'stage style',
        type: 'stageStyleEventJoint',
        beat: 3.5,
        object: { noteAlpha: 0, judgmentLineColor: 'red' },
    },
    {
        name: 'stage transform',
        type: 'stageTransformEventJoint',
        beat: 4,
        object: { rotation: 90, yTranslation: 2 },
    },
]

test.beforeEach(async ({ page }) => {
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
})

for (const scenario of cases) {
    test(`${scenario.name} property preview matches its committed command`, async ({ page }) => {
        const result = await page.evaluate(async (scenario) => {
            const { createEditedEntitiesState } =
                (await import('/src/state/operations/edit.ts')) as typeof import('../../src/state/operations/edit')
            const { editSelectedEditableEntities } =
                (await import('/src/editor/sidebars/default/index.ts')) as typeof import('../../src/editor/sidebars/default')
            const { notification } =
                (await import('/src/editor/notification.ts')) as typeof import('../../src/editor/notification')
            const { history, store, settings, view, fixtures, show } = window.editorTest
            const timeScale: TimeScaleObject = {
                groupId: 1 as GroupId,
                beat: 2,
                editorLane: 3,
                timeScale: -1,
                skip: 0.5,
                timeScaleEase: 'inQuad',
                timeScaleTransition: 'scroll',
                hideNotes: true,
            }
            show({
                ...fixtures.events,
                bpms: [
                    { beat: 0, bpm: 120 },
                    { beat: 4, bpm: 180 },
                ],
                slides: fixtures.interaction.slides,
                timeScales: [
                    timeScale,
                    { ...timeScale, beat: 4, timeScale: 2 },
                    { ...timeScale, groupId: 2 as GroupId, beat: 4, timeScale: 3 },
                ],
            })
            settings.autoAddGroup = false
            const entity = [...store.getAllEntities()].find(
                (entity) => entity.type === scenario.type && entity.beat === scenario.beat,
            )!
            history.replaceState({ ...history.state.value, selectedEntities: [entity] })
            const source = history.state.value
            const serialize = (value: unknown) =>
                JSON.stringify(value, (_, item: unknown) =>
                    item instanceof Map || item instanceof Set ? [...item] : item,
                )
            const before = serialize(source)
            const cursor = view.cursorTime
            const notificationId = notification.value.id
            const preview = createEditedEntitiesState(source, [entity], scenario.object, {
                autoAddGroup: false,
            })
            const sourceUnchanged = history.state.value === source && serialize(source) === before
            const previewHasNoSideEffects =
                !history.canUndo.value && notification.value.id === notificationId
            editSelectedEditableEntities(scenario.object)
            const committed = history.state.value
            const result = {
                matchingState: serialize(preview) === serialize(committed),
                sourceUnchanged,
                previewHasNoSideEffects,
                groupsReused: preview.groups === source.groups,
                notificationCount: notification.value.id - notificationId,
                timeUnchanged: view.cursorTime === cursor,
                bpms: [...committed.store.grid.bpm.values()]
                    .flatMap((entities) => [...entities])
                    .map(({ beat, bpm }) => ({ beat, bpm }))
                    .sort((a, b) => a.beat - b.beat),
                timeScales: [...committed.store.grid.timeScale.values()]
                    .flatMap((entities) => [...entities])
                    .map(({ beat, groupId, timeScale }) => ({ beat, groupId, timeScale }))
                    .sort((a, b) => a.groupId - b.groupId || a.beat - b.beat),
                selected: committed.selectedEntities[0],
            }
            history.undoState()
            return {
                ...result,
                undoRestoredSource: history.state.value === source && !history.canUndo.value,
            }
        }, scenario)

        expect(result).toMatchObject({
            matchingState: true,
            sourceUnchanged: true,
            previewHasNoSideEffects: true,
            groupsReused: true,
            notificationCount: 1,
            timeUnchanged: true,
            undoRestoredSource: true,
        })
        if (scenario.name === 'initial BPM overlap') {
            expect(result.bpms).toEqual([
                { beat: 0, bpm: 120 },
                { beat: 4, bpm: 120 },
            ])
        }
        if (scenario.name === 'BPM move to zero')
            expect(result.bpms).toEqual([{ beat: 0, bpm: 90 }])
        if (scenario.name === 'time scale target group') {
            expect(result.timeScales).toEqual([
                { beat: 4, groupId: 1, timeScale: 2 },
                { beat: 4, groupId: 2, timeScale: 0 },
            ])
        }
        if (scenario.name === 'time scale group at same beat') {
            expect(
                result.timeScales.filter(({ beat, groupId }) => beat === 4 && groupId === 2),
            ).toHaveLength(2)
        }
        if (scenario.name === 'time scale unspecified fields') {
            expect(result.selected).toMatchObject({ editorLane: 0, timeScale: -1, hideNotes: true })
        }
        if (scenario.name === 'note connector defaults') {
            expect(result.selected).toMatchObject({
                connectorActiveIsCritical: true,
                connectorIsFake: true,
            })
        }
    })
}

test('batch BPM properties retain batch semantics and commit one undo step', async ({ page }) => {
    const result = await page.evaluate(async () => {
        const { createEditedEntitiesState } =
            (await import('/src/state/operations/edit.ts')) as typeof import('../../src/state/operations/edit')
        const { editSelectedEditableEntities } =
            (await import('/src/editor/sidebars/default/index.ts')) as typeof import('../../src/editor/sidebars/default')
        const { history, store, fixtures, show } = window.editorTest
        show({
            ...fixtures.interaction,
            bpms: [
                { beat: 0, bpm: 120 },
                { beat: 4, bpm: 180 },
            ],
        })
        const selected = [...store.getAllEntities()].filter((entity) => entity.type === 'bpm')
        history.replaceState({ ...history.state.value, selectedEntities: selected })
        const source = history.state.value
        const preview = createEditedEntitiesState(source, selected, { beat: 2 })
        editSelectedEditableEntities({ beat: 2 })
        const beats = (state: typeof source) =>
            [...state.store.grid.bpm.values()]
                .flatMap((entities) => [...entities])
                .map(({ beat }) => beat)
        const result = { preview: beats(preview), committed: beats(history.state.value) }
        history.undoState()
        return {
            ...result,
            undoRestoredSource: history.state.value === source && !history.canUndo.value,
        }
    })
    expect(result).toEqual({ preview: [2, 2], committed: [2, 2], undoRestoredSource: true })
})
