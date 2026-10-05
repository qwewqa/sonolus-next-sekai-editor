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

test('explicit hiding wins over focus and show-other settings', () => {
    for (const focus of [undefined, groupA, groupB]) {
        for (const showOthers of [true, false]) {
            assert.equal(resolveScopeVisibility(groupA, focus, 'hidden', showOthers), 'hidden')
        }
    }
})

test('focus keeps its target fully visible and dims or hides the rest', () => {
    assert.equal(resolveScopeVisibility(groupA, undefined, undefined, false), 'full')
    assert.equal(resolveScopeVisibility(groupA, groupA, undefined, false), 'full')
    assert.equal(resolveScopeVisibility(groupA, groupA, 'shown', false), 'full')
    assert.equal(resolveScopeVisibility(groupB, groupA, undefined, true), 'dimmed')
    assert.equal(resolveScopeVisibility(groupB, groupA, undefined, false), 'hidden')
    // Showing an entry outside a restrictive focus reveals it without making it editable.
    assert.equal(resolveScopeVisibility(groupB, groupA, 'shown', false), 'dimmed')
})

test('scope lookups ignore stage visibility while dynamic stages are disabled', () => {
    const inputs: ScopeInputs = {
        stageId: stageA,
        stageVisibility: stageMask([[stageB, 'hidden']]),
        showOtherStages: false,
    }
    const dynamic = createScopeLookup({ ...inputs, isDynamicStages: true })
    assert.equal(dynamic.stage(stageA), 'full')
    assert.equal(dynamic.stage(stageB), 'hidden')

    const disabled = createScopeLookup({ ...inputs, isDynamicStages: false })
    assert.equal(disabled.stage(stageA), 'full')
    assert.equal(disabled.stage(stageB), 'full')
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

    // Focus-only: an endpoint outside both focused axes is dimmed or hidden by settings.
    const focusedBoth = createScopeLookup({
        groupId: groupA,
        stageId: stageA,
        showOtherGroups: false,
        showOtherStages: true,
    })
    assert.equal(
        entityScopeVisibility(connector(note(groupA, stageB), note(groupB, stageA)), focusedBoth),
        'dimmed',
    )
})

test('ordering omits hidden scopes and fades dimmed ones without bypassing for selection', () => {
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
            groupVisibility: groupMask([
                [groupB, 'hidden'],
                [groupC, 'shown'],
            ]),
            stageVisibility: stageMask([[stageB, 'hidden']]),
            // Explicit hiding must win even when other groups and stages are shown.
            showOtherGroups: false,
            showOtherStages: true,
        }),
        visibilities: allTypes,
        showOtherObjects: true,
    })
    assert.deepEqual(
        new Map(result.map(({ entity, opacity }) => [entity, opacity])),
        new Map<Entity, number>([
            [revealed, 0.25],
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
        groupId: groupA,
        groupVisibility: groupMask([[groupB, 'hidden']]),
        showOtherGroups: false,
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
    assert.equal(reduced({ showOtherGroups: true }), true)
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
