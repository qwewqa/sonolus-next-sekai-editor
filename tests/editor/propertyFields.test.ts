import assert from 'node:assert/strict'
import test from 'node:test'
import { aggregateValues, countOptions, valueRange } from '../../src/editor/utils/aggregate'
import {
    brushFields,
    pickBrush,
    propertyField,
    propertyFields,
    type SelectionContext,
} from '../../src/editor/workspace/properties/fields'
import { summarizeSelection } from '../../src/editor/workspace/properties/summary'
import {
    formatNumber,
    mixedOptions,
    mixedRange,
    mixedValues,
} from '../../src/modals/form/fieldUsage'
import type { Entity } from '../../src/state/entities'

type Row = { kind: string; a?: number; b?: string; hidden?: number }

const rows: Row[] = [
    { kind: 'x', a: 1, b: 'in', hidden: 5 },
    { kind: 'x', a: 3, b: 'in', hidden: 9 },
    { kind: 'y', a: -2, b: 'out' },
]

// `hidden` is unused by the second row, as a tail's connector is.
const appliesTo = (row: Row) => (key: string) => !(row === rows[1] && key === 'hidden')

test('aggregation keeps agreeing values and counts each value in use', () => {
    const { model, usage } = aggregateValues(rows, appliesTo)
    assert.equal(model.a, undefined)
    assert.equal(model.b, undefined)
    assert.equal(model.hidden, 5)
    assert.deepEqual(
        [...(usage.get('b')?.values ?? [])],
        [
            ['in', 2],
            ['out', 1],
        ],
    )
    assert.deepEqual(usage.get('hidden'), { values: new Map([[5, 1]]), covered: 1, total: 2 })
    assert.equal(usage.get('a')?.covered, 3)
    assert.equal(usage.get('a')?.total, 3)
})

test('ranges and option counts read the usage', () => {
    const { usage } = aggregateValues(rows, appliesTo)
    assert.deepEqual(valueRange(usage.get('a')), [-2, 3])
    assert.deepEqual(
        valueRange(usage.get('a'), (value) => value + 1),
        [-1, 4],
    )
    assert.equal(valueRange(usage.get('b')), undefined)
    assert.equal(valueRange(undefined), undefined)
    assert.deepEqual(countOptions(usage.get('b'), ['out', 'in', 'none']), [1, 2, 0])
    assert.deepEqual(
        countOptions(usage.get('b'), ['i', 'o'], (value, option) =>
            String(value).startsWith(option),
        ),
        [2, 1],
    )
})

const context = (values: Partial<SelectionContext>): SelectionContext => ({
    types: {},
    noteFields: {},
    count: 1,
    isDynamicStages: true,
    ...values,
})

const shown = (values: Partial<SelectionContext>) =>
    propertyFields.filter((field) => field.show(context(values))).map((field) => field.key)

test('a single note shows its fields grouped as before, elevation last', () => {
    const keys = shown({ types: { note: true } })
    assert.deepEqual(keys.slice(0, 3), ['beat', 'left', 'size'])
    assert.equal(keys.at(-1), 'elevation')
    assert.ok(keys.includes('connectorEase'))
    assert.ok(keys.includes('stageId'))
})

test('fields hidden for every selected note stay hidden', () => {
    const keys = shown({ types: { note: true }, noteFields: { connectorEase: false, left: false } })
    assert.ok(!keys.includes('connectorEase'))
    assert.ok(!keys.includes('left'))
    assert.ok(keys.includes('size'))
})

test('beat hides for several BPM or time scale changes', () => {
    assert.ok(!shown({ types: { bpm: true, note: true }, count: 3 }).includes('beat'))
    assert.ok(shown({ types: { bpm: true }, count: 1 }).includes('beat'))
})

test('stage fields need dynamic stages', () => {
    assert.ok(!shown({ types: { note: true }, isDynamicStages: false }).includes('stageId'))
})

test('fields keep sections in order and each key appears once', () => {
    const keys = propertyFields.map((field) => field.key)
    assert.equal(new Set(keys).size, keys.length)
    const order = ['position', 'values', 'connector', 'organization', 'advanced']
    const sections = propertyFields.map((field) => order.indexOf(field.section))
    assert.deepEqual(
        sections,
        [...sections].sort((a, b) => a - b),
    )
})

test('the brush offers only properties it can apply', () => {
    const keys = brushFields.map((field) => field.key) as string[]
    for (const key of [
        'beat',
        'left',
        'editorLane',
        'bpm',
        'meter',
        'cameraLeft',
        'maskLeft',
        'pivotLane',
        'xTranslation',
    ])
        assert.ok(!keys.includes(key), key)
    assert.equal(keys.length, 52)
    assert.equal(propertyField.get('connectorEase')?.ease, true)
})

test('mixed fields name their values, ranges and counts', () => {
    const usage = {
        values: new Map<unknown, number>([
            [-4, 2],
            [0.1 + 0.2, 1],
            [6, 3],
        ]),
        covered: 6,
        total: 6,
    }
    assert.equal(mixedRange({ usage }), '−4 … 6')
    assert.equal(mixedRange({ usage, map: (value) => (value as number) + 1 }), '−3 … 7')
    assert.equal(formatNumber(0.1 + 0.2), '0.3')
    assert.equal(
        mixedRange({ usage: { values: new Map([[1, 4]]), covered: 4, total: 4 } }),
        undefined,
    )

    const toggles = {
        values: new Map<unknown, number>([
            [false, 1],
            [true, 3],
        ]),
        covered: 4,
        total: 4,
    }
    const narrowed: unknown[][] = []
    const values = mixedValues(
        {
            usage: toggles,
            narrow: (predicate) => narrowed.push([false, true].filter(predicate)),
        },
        (value) => `${value}`,
    )
    assert.deepEqual(
        values.map(({ label, count }) => [label, count]),
        [
            ['true', 3],
            ['false', 1],
        ],
    )
    values[0]?.narrow?.()
    assert.deepEqual(narrowed, [[true]])
    // Values a field cannot name are not listed.
    assert.deepEqual(
        mixedValues({ usage: toggles }, () => undefined),
        [],
    )

    const eases = {
        values: new Map<unknown, number>([
            ['inQuad', 2],
            ['outQuad', 1],
        ]),
        covered: 3,
        total: 3,
    }
    assert.deepEqual(
        mixedOptions(
            {
                usage: eases,
                matches: (value, option) => (value as string).startsWith(option as string),
            },
            [
                ['In', 'in'],
                ['Out', 'out'],
                ['In-Out', 'inOut'],
            ],
        ).map(({ label, count }) => [label, count]),
        [
            ['In', 2],
            ['Out', 1],
        ],
    )
})

test('the selection summary counts kinds in order and only slides of several notes', () => {
    const entities = [
        { type: 'bpm' },
        { type: 'note', slideId: 1 },
        { type: 'note', slideId: 1 },
        { type: 'note', slideId: 2 },
        { type: 'timeScale' },
        { type: 'note', slideId: 3 },
    ] as unknown as Entity[]
    const lengths = new Map([
        [1, 3],
        [2, 1],
        [3, 2],
    ])
    assert.deepEqual(
        summarizeSelection(entities, (slideId) => lengths.get(slideId) ?? 0),
        {
            kinds: [
                { kind: 'note', count: 4 },
                { kind: 'bpm', count: 1 },
                { kind: 'timeScale', count: 1 },
            ],
            slides: 2,
        },
    )
})

test('picking a brush keeps agreeing values and the agreeing half of eases', () => {
    const notes = [
        { noteType: 'default', size: 2, connectorEase: 'inQuad', beat: 1, cameraSize: 4 },
        { noteType: 'default', size: 3, connectorEase: 'inCubic', beat: 2, cameraSize: 4 },
    ]
    const aggregate = aggregateValues(notes, () => () => true)
    assert.deepEqual(pickBrush(aggregate, false), {
        noteType: 'default',
        connectorEase: 'mode:in',
    })
    assert.deepEqual(pickBrush(aggregate, true), {
        noteType: 'default',
        connectorEase: 'mode:in',
        cameraSize: 4,
    })
})
