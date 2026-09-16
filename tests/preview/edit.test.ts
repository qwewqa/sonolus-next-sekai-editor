import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import {
    clearPreviewEdit,
    getPreviewState,
    previewEdit,
    setPreviewEdit,
} from '../../src/preview/edit'
import { createState, type State } from '../../src/state'

const sourceState = () =>
    createState(
        {
            initialLife: 1000,
            isDynamicStages: true,
            bpms: [{ beat: 0, bpm: 120 }],
            groups: new Map(),
            stages: new Map(),
            cameraEvents: [],
            stageMaskEvents: [],
            stagePivotEvents: [],
            stageStyleEvents: [],
            stageTransformEvents: [],
            timeScales: [],
            slides: [],
        },
        0,
    )

afterEach(clearPreviewEdit)

test('speculative preview edits resolve lazily and reuse the resolved state', () => {
    const source = sourceState()
    const edited = { ...source, store: { ...source.store } }
    let builds = 0

    setPreviewEdit(source, () => {
        builds++
        return edited
    })

    assert.equal(builds, 0)
    assert.equal(getPreviewState(source), edited)
    assert.equal(getPreviewState(source), edited)
    assert.equal(builds, 1)
})

test('multiple publications before a preview frame build only the latest edit', () => {
    const source = sourceState()
    const states = Array.from({ length: 3 }, () => ({ ...source, store: { ...source.store } }))
    const built: State[] = []

    for (const edited of states) {
        setPreviewEdit(source, () => {
            built.push(edited)
            return edited
        })
    }

    assert.deepEqual(built, [])
    assert.equal(getPreviewState(source), states[2])
    assert.deepEqual(built, [states[2]])
})

test('repeated snapped edits retain pending and resolved drafts without invoking their builders', () => {
    const source = sourceState()
    const entity = {}
    const edited = { ...source, store: { ...source.store } }
    let builds = 0
    const build = () => {
        builds++
        return edited
    }
    const redundant = () => assert.fail('An unchanged snapped edit must not rebuild')

    setPreviewEdit(source, build, [entity, 4, -1, 2])
    const token = previewEdit.value
    setPreviewEdit(source, redundant, [entity, 4, -1, 2])
    assert.equal(previewEdit.value, token)
    assert.equal(builds, 0)

    assert.equal(getPreviewState(source), edited)
    setPreviewEdit({ ...source, selectedEntities: [] }, redundant, [entity, 4, -1, 2])
    assert.equal(previewEdit.value, token)
    assert.equal(getPreviewState(source), edited)
    assert.equal(builds, 1)
})

test('changed targets, snapped fields and chart sources cannot reuse a keyed draft', () => {
    const source = sourceState()
    const entity = {}
    setPreviewEdit(source, () => source, [entity, 4])
    let token = previewEdit.value

    for (const dependencies of [
        [entity, 5],
        [{}, 5],
        [entity, 4, 2],
    ]) {
        setPreviewEdit(source, () => source, dependencies)
        assert.notEqual(previewEdit.value, token)
        token = previewEdit.value
    }

    const next = { ...source, store: { ...source.store } }
    setPreviewEdit(next, () => next, [entity, 4, 2])
    assert.notEqual(previewEdit.value, token)
    assert.equal(getPreviewState(next), next)
    token = previewEdit.value

    clearPreviewEdit()
    setPreviewEdit(next, () => next, [entity, 4, 2])
    assert.notEqual(previewEdit.value, token)
})

test('metadata-only history replacements retain the active preview edit', () => {
    const source = sourceState()
    const edited = { ...source, store: { ...source.store } }
    const metadataReplacement = {
        ...source,
        filename: 'renamed.json',
        bgm: { offset: 1 },
        initialLife: 2000,
        selectedEntities: [],
    }

    setPreviewEdit(source, () => edited)

    assert.notEqual(metadataReplacement, source)
    assert.equal(getPreviewState(metadataReplacement), edited)
})

test('changes to any chart dependency reject an edit without building it', () => {
    const source = sourceState()
    const replacements: State[] = [
        { ...source, store: { ...source.store } },
        { ...source, bpms: [...source.bpms] },
        { ...source, groups: new Map(source.groups) },
        { ...source, stages: new Map(source.stages) },
        { ...source, isDynamicStages: !source.isDynamicStages },
    ]
    let builds = 0
    setPreviewEdit(source, () => {
        builds++
        return source
    })

    for (const replacement of replacements) {
        assert.equal(getPreviewState(replacement), replacement)
    }
    assert.equal(builds, 0)
})

test('undo to another chart state ignores an edit belonging to the newer state', () => {
    const previous = sourceState()
    const current = { ...previous, store: { ...previous.store } }
    let builds = 0
    setPreviewEdit(current, () => {
        builds++
        return { ...current, store: { ...current.store } }
    })

    assert.equal(getPreviewState(previous), previous)
    assert.equal(builds, 0)
})

test('cancelling an edit restores the committed state even after it was resolved', () => {
    const source = sourceState()
    const edited = { ...source, store: { ...source.store } }
    assert.equal(getPreviewState(source), source)

    setPreviewEdit(source, () => edited)
    assert.equal(getPreviewState(source), edited)
    clearPreviewEdit()

    assert.equal(previewEdit.value, undefined)
    assert.equal(getPreviewState(source), source)
})
