import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import type { GroupId } from '../../src/chart/groups'
import type { StageId } from '../../src/chart/stages'
import { orderEntities } from '../../src/editor/canvas/ordering'
import {
    bestScope,
    createScopeLookup,
    entityScopeIds,
    entityScopeVisibility,
    fullScope,
    isScopeReduced,
    resolveScopeVisibility,
    stepFocus,
    worstScope,
    type ScopeInputs,
    type ScopeOverride,
} from '../../src/editor/scopeRules'
import type { Entity, EntityType } from '../../src/state/entities'
import type { ConnectorEntity } from '../../src/state/entities/slides/connector'
import type { NoteEntity } from '../../src/state/entities/slides/note'

const groupA = 1 as GroupId
const groupB = 2 as GroupId
const groupC = 3 as GroupId
const stageA = 1 as StageId
const stageB = 2 as StageId

const note = (groupId: GroupId, stageId: StageId, beat = 0): NoteEntity =>
    ({ type: 'note', beat, groupId, stageId }) as NoteEntity

const connector = (head: NoteEntity, tail: NoteEntity): ConnectorEntity =>
    ({
        type: 'connector',
        beat: head.beat,
        head: { ...head, connectorLayer: 'top', connectorType: 'active' },
        tail,
        attachHead: head,
        attachTail: tail,
        segmentHead: head,
        segmentTail: tail,
    }) as ConnectorEntity

const allTypes = new Proxy({} as Record<EntityType, boolean>, { get: () => true })

const groupMask = (entries: [GroupId, ScopeOverride][]) => new Map(entries)
const stageMask = (entries: [StageId, ScopeOverride][]) => new Map(entries)

test('Show Other off isolates focus regardless of masks; Show Other on preserves manual hiding and dimming', () => {
    for (const override of [undefined, 'shown', 'hidden'] as const) {
        for (const showOthers of [false, true]) {
            assert.equal(
                resolveScopeVisibility(groupA, undefined, override, showOthers),
                override === 'hidden' ? 'hidden' : 'full',
            )
        }
        assert.equal(resolveScopeVisibility(groupA, groupA, override, false), 'full')
        assert.equal(resolveScopeVisibility(groupA, groupB, override, false), 'hidden')
        assert.equal(
            resolveScopeVisibility(groupA, groupA, override, true),
            override === 'hidden' ? 'hidden' : 'full',
        )
        assert.equal(
            resolveScopeVisibility(groupA, groupB, override, true),
            override === 'hidden' ? 'hidden' : 'dimmed',
        )
    }
})

test('group and stage isolation leave saved All masks intact across every focus combination', () => {
    const groupVisibility = groupMask([
        [groupA, 'hidden'],
        [groupB, 'shown'],
    ])
    const stageVisibility = stageMask([
        [stageA, 'hidden'],
        [stageB, 'shown'],
    ])
    const savedGroups = new Map(groupVisibility)
    const savedStages = new Map(stageVisibility)
    const all = () => createScopeLookup({ groupVisibility, stageVisibility })
    const before = all()
    assert.deepEqual(
        [before.group(groupA), before.group(groupB), before.stage(stageA), before.stage(stageB)],
        ['hidden', 'full', 'hidden', 'full'],
    )

    // Rows correspond to All, the hidden first entry, and the shown second entry.
    const expected = {
        false: [
            ['hidden', 'full'],
            ['full', 'hidden'],
            ['hidden', 'full'],
        ],
        true: [
            ['hidden', 'full'],
            ['hidden', 'dimmed'],
            ['hidden', 'full'],
        ],
    }
    for (const showOtherGroups of [false, true]) {
        for (const showOtherStages of [false, true]) {
            for (const [groupIndex, groupId] of [undefined, groupA, groupB].entries()) {
                for (const [stageIndex, stageId] of [undefined, stageA, stageB].entries()) {
                    const focused = createScopeLookup({
                        groupId,
                        stageId,
                        groupVisibility,
                        stageVisibility,
                        showOtherGroups,
                        showOtherStages,
                    })
                    assert.deepEqual(
                        [focused.group(groupA), focused.group(groupB)],
                        expected[showOtherGroups ? 'true' : 'false'][groupIndex],
                    )
                    assert.deepEqual(
                        [focused.stage(stageA), focused.stage(stageB)],
                        expected[showOtherStages ? 'true' : 'false'][stageIndex],
                    )
                    assert.deepEqual(groupVisibility, savedGroups)
                    assert.deepEqual(stageVisibility, savedStages)
                }
            }
        }
    }
    const restored = all()
    assert.deepEqual(
        [
            restored.group(groupA),
            restored.group(groupB),
            restored.stage(stageA),
            restored.stage(stageB),
        ],
        ['hidden', 'full', 'hidden', 'full'],
    )
})

test('next and previous step through the entries with all between the ends', () => {
    const ids = [groupA, groupB, groupC]
    assert.equal(stepFocus(ids, undefined, 1), groupA)
    assert.equal(stepFocus(ids, groupA, 1), groupB)
    assert.equal(stepFocus(ids, groupC, 1), undefined)
    assert.equal(stepFocus(ids, undefined, -1), groupC)
    assert.equal(stepFocus(ids, groupB, -1), groupA)
    assert.equal(stepFocus(ids, groupA, -1), undefined)
    // A focus that no longer exists restarts from the ends.
    assert.equal(stepFocus([groupB], groupA, 1), groupB)
    assert.equal(stepFocus([], undefined, 1), undefined)
})

test('setting flips switch isolation and dimming without rewriting masks and reduce scope snapshots', () => {
    const groupVisibility = groupMask([
        [groupA, 'hidden'],
        [groupB, 'shown'],
    ])
    const stageVisibility = stageMask([
        [stageA, 'hidden'],
        [stageB, 'shown'],
    ])
    const enabled = createScopeLookup({
        groupId: groupA,
        stageId: stageA,
        groupVisibility,
        stageVisibility,
    })
    assert.deepEqual(
        [
            enabled.group(groupA),
            enabled.group(groupB),
            enabled.stage(stageA),
            enabled.stage(stageB),
        ],
        ['hidden', 'dimmed', 'hidden', 'dimmed'],
    )
    const isolated = createScopeLookup({
        groupId: groupA,
        stageId: stageA,
        groupVisibility,
        stageVisibility,
        showOtherGroups: false,
        showOtherStages: false,
    })
    assert.deepEqual(
        [
            isolated.group(groupA),
            isolated.group(groupB),
            isolated.stage(stageA),
            isolated.stage(stageB),
        ],
        ['full', 'hidden', 'full', 'hidden'],
    )
    assert.equal(isScopeReduced(enabled, isolated), true)
    // Turning Show Other back on hides the selected entry again if its saved eye was off.
    assert.equal(isScopeReduced(isolated, enabled), true)
    for (const showOtherGroups of [false, true]) {
        for (const showOtherStages of [false, true]) {
            const all = createScopeLookup({
                groupVisibility,
                stageVisibility,
                showOtherGroups,
                showOtherStages,
            })
            assert.deepEqual(
                [all.group(groupA), all.group(groupB), all.stage(stageA), all.stage(stageB)],
                ['hidden', 'full', 'hidden', 'full'],
            )
            assert.equal(all.inputs?.groupVisibility, groupVisibility)
            assert.equal(all.inputs?.stageVisibility, stageVisibility)
        }
    }
})

test('scope lookups ignore stage visibility while dynamic stages are disabled', () => {
    const inputs: ScopeInputs = {
        stageId: stageA,
        showOtherStages: false,
        stageVisibility: stageMask([
            [stageA, 'hidden'],
            [stageB, 'hidden'],
        ]),
    }
    const dynamic = createScopeLookup({ ...inputs, isDynamicStages: true })
    assert.equal(dynamic.stage(stageA), 'full')
    assert.equal(dynamic.stage(stageB), 'hidden')

    const disabled = createScopeLookup({ ...inputs, isDynamicStages: false })
    assert.equal(disabled.stage(stageA), 'full')
    assert.equal(disabled.stage(stageB), 'full')

    const restored = createScopeLookup({ ...inputs, stageId: undefined, isDynamicStages: true })
    assert.equal(restored.stage(stageA), 'hidden')
    assert.equal(restored.stage(stageB), 'hidden')
})

test('scope combinators pick the least and most visible values', () => {
    assert.equal(worstScope('full', 'dimmed'), 'dimmed')
    assert.equal(worstScope('dimmed', 'hidden'), 'hidden')
    assert.equal(worstScope('full', 'full'), 'full')
    assert.equal(bestScope('hidden', 'dimmed'), 'dimmed')
    assert.equal(bestScope('dimmed', 'full'), 'full')
    assert.equal(bestScope('hidden', 'hidden'), 'hidden')
})

test('entity scope follows each type’s group and stage membership', () => {
    const scope = createScopeLookup({
        groupVisibility: groupMask([[groupB, 'hidden']]),
        stageVisibility: stageMask([[stageB, 'hidden']]),
    })
    const of = (entity: unknown) => entityScopeVisibility(entity as Entity, scope)

    assert.equal(of(note(groupA, stageA)), 'full')
    assert.equal(of(note(groupB, stageA)), 'hidden')
    assert.equal(of(note(groupA, stageB)), 'hidden')
    assert.equal(of({ type: 'timeScale', groupId: groupB }), 'hidden')
    assert.equal(of({ type: 'timeScale', groupId: groupA }), 'full')
    assert.equal(of({ type: 'stagePivotEventJoint', stageId: stageB }), 'hidden')
    assert.equal(of({ type: 'stagePivotEventConnection', min: { stageId: stageB } }), 'hidden')
    assert.equal(of({ type: 'stageMaskEventConnection', min: { stageId: stageA } }), 'full')
    assert.equal(of({ type: 'bpm' }), 'full')
    assert.equal(of({ type: 'cameraEventJoint' }), 'full')
    assert.equal(of({ type: 'cameraEventConnection' }), 'full')

    for (const entity of [note(groupA, stageA), { type: 'timeScale', groupId: groupB }]) {
        assert.equal(entityScopeVisibility(entity as Entity, fullScope), 'full')
    }
})

test('a connector stays drawn while either attachment endpoint is visible', () => {
    const hiddenB = createScopeLookup({ groupVisibility: groupMask([[groupB, 'hidden']]) })
    assert.equal(
        entityScopeVisibility(connector(note(groupA, stageA), note(groupB, stageA)), hiddenB),
        'full',
    )
    assert.equal(
        entityScopeVisibility(connector(note(groupB, stageA), note(groupA, stageA)), hiddenB),
        'full',
    )
    assert.equal(
        entityScopeVisibility(connector(note(groupB, stageA), note(groupB, stageB)), hiddenB),
        'hidden',
    )

    // A dimmed endpoint keeps a connector between hidden and dimmed groups faint.
    const focused = createScopeLookup({
        groupId: groupA,
        groupVisibility: groupMask([[groupB, 'hidden']]),
        showOtherGroups: true,
    })
    assert.equal(
        entityScopeVisibility(connector(note(groupB, stageA), note(groupC, stageA)), focused),
        'dimmed',
    )

    // Each endpoint combines its own group and stage: endpoints hidden on
    // different axes still hide the connector.
    const both = createScopeLookup({
        groupVisibility: groupMask([[groupB, 'hidden']]),
        stageVisibility: stageMask([[stageB, 'hidden']]),
    })
    assert.equal(
        entityScopeVisibility(connector(note(groupA, stageB), note(groupB, stageB)), both),
        'hidden',
    )
    assert.equal(
        entityScopeVisibility(connector(note(groupA, stageB), note(groupB, stageA)), both),
        'hidden',
    )
    assert.equal(
        entityScopeVisibility(connector(note(groupA, stageB), note(groupA, stageA)), both),
        'full',
    )

    // Isolation on both axes hides endpoints outside either focused membership.
    const focusedBoth = createScopeLookup({
        groupId: groupA,
        stageId: stageA,
        showOtherGroups: false,
        showOtherStages: false,
    })
    assert.equal(
        entityScopeVisibility(connector(note(groupA, stageB), note(groupB, stageA)), focusedBoth),
        'hidden',
    )
})

test('ordering isolates scopes without allowing saved shows or selection to bypass focus', () => {
    const visible = note(groupA, stageA, 1)
    const hiddenGroup = note(groupB, stageA, 2)
    const hiddenStage = note(groupA, stageB, 3)
    const revealed = note(groupC, stageA, 4)
    const bridge = connector(visible, hiddenGroup)
    const orphan = connector(hiddenGroup, note(groupB, stageA, 5))
    const entities: Entity[] = [visible, hiddenGroup, hiddenStage, revealed, bridge, orphan]
    const result = orderEntities(entities, new Set(entities), {
        scope: createScopeLookup({
            groupId: groupA,
            showOtherGroups: false,
            groupVisibility: groupMask([
                [groupA, 'hidden'],
                [groupB, 'hidden'],
                [groupC, 'shown'],
            ]),
            stageVisibility: stageMask([[stageB, 'hidden']]),
        }),
        visibilities: allTypes,
        showOtherObjects: true,
    })
    assert.deepEqual(
        new Map(result.map(({ entity, opacity }) => [entity, opacity])),
        new Map<Entity, number>([
            [bridge, 1],
            [visible, 1],
        ]),
    )
})

test('ordering keeps hidden-type and hidden-scope fades as a single opacity', () => {
    const dimmed = note(groupB, stageA)
    const [entry] = orderEntities([dimmed], new Set(), {
        scope: createScopeLookup({ groupId: groupA, showOtherGroups: true }),
        visibilities: { ...allTypes, note: false },
        showOtherObjects: true,
    })
    assert.equal(entry?.opacity, 0.25)
})

test('only scope changes that can hide something count as reductions', () => {
    const base: ScopeInputs = {
        groupVisibility: groupMask([[groupB, 'hidden']]),
    }
    const reduced = (next: ScopeInputs) =>
        isScopeReduced(createScopeLookup(base), createScopeLookup({ ...base, ...next }))

    // Revealing entries, as authoring and the eye controls do, never hides anything.
    assert.equal(reduced({ groupVisibility: groupMask([]) }), false)
    assert.equal(
        reduced({
            groupVisibility: groupMask([
                [groupB, 'shown'],
                [groupC, 'shown'],
            ]),
        }),
        false,
    )
    assert.equal(reduced({}), false)

    assert.equal(
        reduced({
            groupVisibility: groupMask([
                [groupB, 'hidden'],
                [groupC, 'hidden'],
            ]),
        }),
        true,
    )
    assert.equal(reduced({ groupId: groupB }), true)
    assert.equal(reduced({ stageId: stageB }), true)
    assert.equal(reduced({ showOtherGroups: false }), true)
    assert.equal(reduced({ showOtherStages: false }), true)
    assert.equal(reduced({ stageVisibility: stageMask([[stageA, 'hidden']]) }), true)
    assert.equal(isScopeReduced(undefined, createScopeLookup(base)), true)
    assert.equal(isScopeReduced(fullScope, createScopeLookup(base)), true)
})

test('authored entities reveal the groups and stages they belong to', () => {
    assert.deepEqual(entityScopeIds(note(groupB, stageB)), { groupId: groupB, stageId: stageB })
    assert.deepEqual(entityScopeIds({ type: 'timeScale', groupId: groupC } as Entity), {
        groupId: groupC,
    })
    assert.deepEqual(entityScopeIds({ type: 'stageStyleEventJoint', stageId: stageB } as Entity), {
        stageId: stageB,
    })
    assert.deepEqual(entityScopeIds({ type: 'bpm' } as Entity), {})
})

const sourceFiles = (directory: string): string[] =>
    readdirSync(directory).flatMap((name) => {
        const path = join(directory, name)
        if (statSync(path).isDirectory()) return sourceFiles(path)
        return /\.(ts|vue)$/.test(name) ? [path] : []
    })

test('preview, serialization, clipboard and chart state never read editor visibility', () => {
    const pattern =
        /groupVisibility|stageVisibility|groupScope|stageScope|scopeLookup|scopeRules|editor\/scope/
    for (const directory of [
        'src/preview',
        'src/levelData',
        'src/clipboard',
        'src/chart',
        'src/state',
        'src/history',
    ]) {
        for (const file of sourceFiles(directory)) {
            assert.doesNotMatch(readFileSync(file, 'utf8'), pattern, file)
        }
    }
})
