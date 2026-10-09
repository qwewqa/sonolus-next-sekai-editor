import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

const files = {
    note: 'src/editor/tools/note/index.ts',
    slide: 'src/editor/tools/slide/index.ts',
    select: 'src/editor/tools/select.ts',
}
// Opt-in historical audit: normal test runs neither need Git history nor compare
// against a moving reference after this implementation is committed.
const baselineRef = process.env.COMPOSED_BASELINE_REF
test.skip(!baselineRef, 'Set COMPOSED_BASELINE_REF to the pre-Composed commit for this audit')
const baseline = Object.fromEntries(
    (baselineRef ? Object.entries(files) : []).map(([name, filename]) => {
        const source = execFileSync('git', ['show', `${baselineRef}:${filename}`], {
            encoding: 'utf8',
        })
        const compiled = ts.transpileModule(source, {
            compilerOptions: {
                module: ts.ModuleKind.ESNext,
                target: ts.ScriptTarget.ES2022,
            },
        }).outputText
        return [
            name,
            compiled.replace(
                /from (['"])([^'"]+)\1/g,
                (match, quote: string, specifier: string) => {
                    if (!specifier.startsWith('.')) return match
                    const target = path.resolve(path.dirname(filename), specifier)
                    const resolved = [target, `${target}.ts`, path.join(target, 'index.ts')].find(
                        (candidate) => existsSync(candidate) && /\.(ts|vue)$/.test(candidate),
                    )
                    if (!resolved)
                        throw new Error(`Cannot resolve baseline dependency ${specifier}`)
                    return `from ${quote}/${path.relative(process.cwd(), resolved).replaceAll('\\', '/')}${quote}`
                },
            ),
        ]
    }),
)

test.beforeEach(async ({ page }) => {
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
})

for (const toolName of ['note', 'slide', 'select'] as const) {
    for (const mode of ['basic-dynamic', 'composed-ordinary'] as const) {
        for (const action of [
            'relative-move',
            'absolute-move',
            'resize',
            'attached-crossing',
            'mixed-move',
        ] as const) {
            if (action === 'mixed-move' && toolName !== 'select') continue
            test(`${toolName}: ${mode} ${action} matches baseline gestures`, async ({ page }) => {
                const result = await page.evaluate(
                    async ({ toolName, mode, action, baselineSource, filename }) => {
                        const { fixtures, show, view, settings, history, store, point, appImport } =
                            window.editorTest
                        const urls = new Map(
                            performance
                                .getEntriesByType('resource')
                                .map((entry) => [new URL(entry.name).pathname, entry.name]),
                        )
                        const source = baselineSource.replace(
                            /from (['"])([^'"]+)\1/g,
                            (match, quote: string, specifier: string) => {
                                if (specifier === 'vue')
                                    return `from ${quote}${urls.get('/node_modules/.vite/deps/vue.js')}${quote}`
                                return specifier.startsWith('/')
                                    ? `from ${quote}${urls.get(specifier) ?? location.origin + specifier}${quote}`
                                    : match
                            },
                        )
                        const baselineModule = (await import(
                            `data:text/javascript;base64,${btoa(source)}`
                        )) as Record<string, import('../../src/editor/tools').Tool>
                        const currentModule = await appImport<
                            Record<string, import('../../src/editor/tools').Tool>
                        >(`/${filename}`)
                        const { clearPreviewEdit } =
                            await appImport<typeof import('../../src/preview/edit')>(
                                '/src/preview/edit.ts',
                            )
                        const scalar = (entity: import('../../src/state/entities').Entity) =>
                            Object.fromEntries(
                                Object.entries(entity).filter(
                                    ([key, value]) =>
                                        key !== 'slideId' && typeof value !== 'object',
                                ),
                            )
                        const run = async (tool: import('../../src/editor/tools').Tool) => {
                            clearPreviewEdit()
                            const base = fixtures.interaction.slides[0]![0]!
                            const pivot = fixtures.events.stagePivotEvents[0]!
                            show(
                                {
                                    ...fixtures.interaction,
                                    isDynamicStages: mode === 'basic-dynamic',
                                    stagePivotEvents: [{ ...pivot, beat: 1, pivotLane: 3 }],
                                    slides:
                                        action === 'attached-crossing'
                                            ? [
                                                  [
                                                      { ...base, beat: 2, left: -2, size: 2 },
                                                      {
                                                          ...base,
                                                          beat: 4,
                                                          left: 0,
                                                          size: 3,
                                                          isAttached: true,
                                                      },
                                                      { ...base, beat: 6, left: 2, size: 4 },
                                                  ],
                                              ]
                                            : [[{ ...base, beat: 4.125, left: 0.3, size: 2.25 }]],
                                },
                                4,
                            )
                            view.layout = mode === 'basic-dynamic' ? 'basic' : 'composed'
                            view.laneDivision = 4
                            view.laneSnapping = action === 'absolute-move' ? 'absolute' : 'relative'
                            view.division = 4
                            view.snapping = action === 'absolute-move' ? 'absolute' : 'relative'
                            settings.maxLane = 6
                            const notes = [...history.state.value.store.slides.note.values()].flat()
                            const focus = action === 'attached-crossing' ? notes[1]! : notes[0]!
                            history.replaceState({
                                ...history.state.value,
                                selectedEntities:
                                    action === 'mixed-move'
                                        ? [...store.getAllEntities()].filter(
                                              (entity) =>
                                                  entity.type === 'note' ||
                                                  entity.type === 'stagePivotEventJoint',
                                          )
                                        : [focus],
                            })
                            const modifiers = { ctrl: false, shift: false }
                            const start = point(
                                action === 'resize'
                                    ? focus.left + focus.size - 0.05
                                    : focus.left + focus.size / 2,
                                focus.beat,
                            )
                            const end = point(
                                action === 'resize'
                                    ? 9
                                    : action === 'attached-crossing'
                                      ? focus.left + focus.size / 2
                                      : 3.67,
                                action === 'attached-crossing' ? 8 : 6.38,
                            )
                            tool.dragStart!(start.x, start.y, modifiers)
                            tool.dragUpdate!(end.x, end.y, modifiers)
                            const ghost = view.entities.creating.map(scalar)
                            await tool.dragEnd!(end.x, end.y, modifiers)
                            return {
                                ghost,
                                notes: [...history.state.value.store.slides.note.values()]
                                    .flat()
                                    .map(scalar),
                                events: [...store.getAllEntities()]
                                    .filter((entity) => entity.type === 'stagePivotEventJoint')
                                    .map(scalar),
                                selected: history.state.value.selectedEntities.map(scalar),
                                canUndo: history.canUndo.value,
                            }
                        }
                        return {
                            baseline: await run(baselineModule[toolName]!),
                            current: await run(currentModule[toolName]!),
                        }
                    },
                    {
                        toolName,
                        mode,
                        action,
                        baselineSource: baseline[toolName]!,
                        filename: files[toolName],
                    },
                )
                expect(result.current).toEqual(result.baseline)
            })
        }
    }
}
