import { expect, test } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

test.beforeEach(async ({ page }) => {
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
})

for (const action of [
    'flip',
    'flipVertical',
    'makeVertical',
    'combineNotes',
    'splitHold',
    'detach',
    'width',
    'beat',
] as const) {
    for (const includeEvents of [false, true]) {
        test(`${action} authors identical level data in Basic and Composed (${includeEvents ? 'mixed selection' : 'notes only'})`, async ({
            page,
        }) => {
            const result = await page.evaluate(
                async ({ action, includeEvents }) => {
                    const { appImport, fixtures, show, view, history, store } = window.editorTest
                    const { commands } = await appImport<
                        typeof import('../../src/editor/commands')
                    >('/src/editor/commands/index.ts')
                    const scaling = await appImport<
                        typeof import('../../src/editor/commands/scaleSelection/session')
                    >('/src/editor/commands/scaleSelection/session.ts')
                    const { transformSelection } = await appImport<
                        typeof import('../../src/state/operations/transformSelection')
                    >('/src/state/operations/transformSelection.ts')
                    const { serializeToLevelData } = await appImport<
                        typeof import('../../src/levelData/serialize')
                    >('/src/levelData/serialize.ts')
                    const base = fixtures.interaction.slides[0]![0]!
                    const pivot = fixtures.events.stagePivotEvents[0]!
                    const transform = fixtures.events.stageTransformEvents[0]!
                    const stageB = 2 as typeof base.stageId
                    const chart = {
                        ...fixtures.interaction,
                        isDynamicStages: true,
                        bpms: [
                            { beat: 0, bpm: 120 },
                            { beat: 3, bpm: 75 },
                        ],
                        stagePivotEvents: [
                            {
                                ...pivot,
                                beat: 0,
                                pivotLane: 1.2,
                                divisionSize: 3,
                                divisionParity: 'odd' as const,
                                eventEase: 'inOutStep' as const,
                            },
                            {
                                ...pivot,
                                beat: 6,
                                pivotLane: 4.7,
                                divisionSize: 2,
                                divisionParity: 'even' as const,
                            },
                            {
                                ...pivot,
                                stageId: stageB,
                                beat: 0,
                                pivotLane: -3.6,
                                eventEase: 'linear' as const,
                            },
                            { ...pivot, stageId: stageB, beat: 8, pivotLane: 2.1 },
                        ],
                        stageTransformEvents: [
                            {
                                ...transform,
                                beat: 0,
                                xTranslation: 0.375,
                                eventEase: 'linear' as const,
                            },
                            { ...transform, beat: 8, xTranslation: 1.625 },
                            { ...transform, stageId: stageB, beat: 0, xTranslation: -1.75 },
                        ],
                        slides: [
                            [
                                {
                                    ...base,
                                    beat: 1,
                                    left: -2.25,
                                    size: 3,
                                    connectorEase: 'inQuad' as const,
                                },
                                {
                                    ...base,
                                    stageId: stageB,
                                    beat: 3,
                                    left: 0,
                                    size: 2,
                                    isAttached: true,
                                },
                                { ...base, beat: 5, left: 0.375, size: 1, isAttached: true },
                                { ...base, stageId: stageB, beat: 7, left: 1.25, size: 2.5 },
                            ],
                            [
                                {
                                    ...base,
                                    stageId: stageB,
                                    beat: 2,
                                    left: -1.125,
                                    size: 1.5,
                                    flickDirection: 'upLeft' as const,
                                },
                            ],
                        ],
                    }
                    const serialize = () => {
                        const source = history.state.value
                        return serializeToLevelData(
                            source.initialLife,
                            source.isDynamicStages,
                            source.bgm.offset,
                            source.store,
                            source.groups,
                            source.stages,
                        )
                    }
                    const results = []
                    for (const layout of ['basic', 'composed'] as const) {
                        show(chart)
                        view.layout = layout
                        const selected = [...store.getAllEntities()].filter(
                            (entity) =>
                                entity.type === 'note' ||
                                (includeEvents &&
                                    [
                                        'bpm',
                                        'stagePivotEventJoint',
                                        'stageTransformEventJoint',
                                    ].includes(entity.type)),
                        )
                        history.replaceState({ ...history.state.value, selectedEntities: selected })
                        const before = serialize()
                        if (action === 'width' || action === 'beat') {
                            if (!scaling.beginScalingSession(action))
                                throw new Error('Scaling session failed to begin')
                            if (!scaling.setScalingFactor(1.37))
                                throw new Error('Numeric scaling factor rejected')
                            if (!scaling.applyScalingSession())
                                throw new Error('Scaling session failed to apply')
                        } else if (action === 'detach') {
                            const source = history.state.value
                            history.pushState(
                                () => 'Detach parity test',
                                transformSelection(
                                    source,
                                    selected,
                                    new Map(
                                        selected
                                            .filter((entity) => entity.type === 'note')
                                            .map((entity) => [entity, { isAttached: false }]),
                                    ),
                                ),
                            )
                        } else {
                            await commands[action].execute()
                        }
                        const after = serialize()
                        history.undoState()
                        const restored = serialize()
                        history.redoState()
                        results.push({ before, after, restored, redone: serialize() })
                    }
                    return results
                },
                { action, includeEvents },
            )
            expect(result[1]).toEqual(result[0])
            for (const edit of result) {
                expect(edit.after).not.toEqual(edit.before)
                expect(edit.restored).toEqual(edit.before)
                expect(edit.redone).toEqual(edit.after)
            }
        })
    }
}
