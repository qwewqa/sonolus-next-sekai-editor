import type { LevelDataEntity } from '@sonolus/core'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import type { Chart } from '../../src/chart'
import type { GroupId } from '../../src/chart/groups'
import type { NoteObject } from '../../src/chart/note'
import type { StageId } from '../../src/chart/stages'
import { serializeToLevelData } from '../../src/levelData/serialize'
import { buildPreviewChart } from '../../src/preview/engine/chart'
import { damageTickInputStartBeat, getHiddenTickHitboxes } from '../../src/preview/engine/hitbox'
import { createState } from '../../src/state'
import type { NoteEntity } from '../../src/state/entities/slides/note'
import { beatToTime } from '../../src/state/integrals/bpms'

const note = (beat: number, overrides: Partial<NoteObject> = {}): NoteObject => ({
    groupId: 1 as GroupId,
    stageId: 1 as StageId,
    beat,
    noteType: 'default',
    isAttached: false,
    left: -1,
    size: 2,
    isCritical: false,
    flickDirection: 'none',
    isFake: false,
    noteStyle: 'default',
    connectorStyle: 'default',
    sfx: 'default',
    isConnectorSeparator: false,
    connectorType: 'active',
    connectorEase: 'linear',
    connectorIsFake: false,
    connectorActiveIsCritical: false,
    connectorGuideAlpha: 1,
    connectorLayer: 'top',
    connectorIsPassThrough: false,
    connectorPresentation: 'default',
    ...overrides,
})

const chart = (slides: NoteObject[][], overrides: Partial<Chart> = {}): Chart => ({
    initialLife: 1000,
    isDynamicStages: true,
    bpms: [
        { beat: 0, bpm: 120 },
        { beat: 33, bpm: 177 },
    ],
    groups: new Map([
        [1 as GroupId, { name: 'A' }],
        [2 as GroupId, { name: 'B' }],
    ]),
    stages: new Map([
        [
            1 as StageId,
            { name: 'S', isFromStart: true, isUntilEnd: true, generateSimLines: 'global' },
        ],
        [
            2 as StageId,
            { name: 'T', isFromStart: true, isUntilEnd: true, generateSimLines: 'isolated' },
        ],
    ]),
    cameraEvents: [],
    stageMaskEvents: [],
    stagePivotEvents: [],
    stageStyleEvents: [],
    stageTransformEvents: [],
    timeScales: [],
    slides,
    ...overrides,
})

const serialize = (source: Chart) => {
    const state = createState(source, 0)
    return serializeToLevelData(
        state.initialLife,
        state.isDynamicStages,
        0,
        state.store,
        state.groups,
        state.stages,
    )
}

// Deterministic charts covering every connector type, separators, attached and
// fake notes, same-beat endpoints, off-grid beats and both stage modes.
const randomCharts = function* () {
    let seed = 12345
    const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
    const pick = <T>(values: readonly T[]) => values[Math.floor(random() * values.length)] as T
    for (let round = 0; round < 40; round++) {
        const slides: NoteObject[][] = []
        for (let s = 0; s < 30; s++) {
            const count = 1 + Math.floor(random() * 7)
            const notes: NoteObject[] = []
            let beat = Math.floor(random() * 64 * 8) / 8
            for (let i = 0; i < count; i++) {
                beat += pick([0, 0.125, 0.25, 1 / 3, 0.5, 0.75, 1, 1.5, 2])
                notes.push(
                    note(beat, {
                        groupId: pick([1, 2]) as GroupId,
                        stageId: pick([1, 2]) as StageId,
                        noteType: pick([
                            'default',
                            'default',
                            'trace',
                            'anchor',
                            'damage',
                            'forceTick',
                            'forceNonTick',
                        ] as const),
                        isAttached: random() < 0.3,
                        left: Math.floor(random() * 10) - 6,
                        size: 1 + Math.floor(random() * 4),
                        isCritical: random() < 0.3,
                        flickDirection: pick(['none', 'none', 'up', 'upLeft', 'down'] as const),
                        isFake: random() < 0.15,
                        isConnectorSeparator: random() < 0.3,
                        connectorType: pick([
                            'active',
                            'active',
                            'guide',
                            'damage',
                            'damage',
                        ] as const),
                        connectorEase: pick(['linear', 'inQuad', 'outQuad', 'inStep'] as const),
                        connectorIsFake: random() < 0.15,
                        connectorActiveIsCritical: random() < 0.3,
                        elevation: random() < 0.2 ? 1 : 0,
                    }),
                )
            }
            slides.push(notes)
        }
        yield chart(slides, { isDynamicStages: round % 2 === 0 })
    }
}

test('level data serialization is byte-identical to the output before the shared hidden tick schedule', () => {
    const hashes = [...randomCharts()].map((source) =>
        createHash('sha256')
            // Recorded when steps in were written as NONE (0).
            .update(
                JSON.stringify(serialize(source)).replaceAll(
                    '{"name":"connectorEase","value":38}',
                    '{"name":"connectorEase","value":0}',
                ),
            )
            .digest('hex'),
    )
    // Recorded from the serializer before the schedule moved into a shared module.
    assert.equal(
        createHash('sha256').update(hashes.join('\n')).digest('hex'),
        'f29d90bba6fe5df51f2186c609f43da259cb5b81401fc276fc28da0ce04e7762',
    )
})

const ref = (entity: LevelDataEntity, name: string) =>
    entity.data.find((data) => data.name === name && 'ref' in data) as { ref: string } | undefined

const value = (entity: LevelDataEntity, name: string) =>
    (entity.data.find((data) => data.name === name && 'value' in data) as { value: number })?.value

const hiddenTicks = (source: Chart) => {
    const { entities } = serialize(source)
    const byName = new Map(
        entities.flatMap((entity) => (entity.name ? [[entity.name, entity]] : [])),
    )
    const beatOf = (name: string | undefined) =>
        name === undefined ? undefined : value(byName.get(name) as LevelDataEntity, '#BEAT')
    return entities
        .filter((entity) => entity.archetype.startsWith('TransientHidden'))
        .map((entity) => ({
            archetype: entity.archetype,
            beat: value(entity, '#BEAT'),
            attachHead: beatOf(ref(entity, 'attachHead')?.ref),
            attachTail: beatOf(ref(entity, 'attachTail')?.ref),
            activeHead: beatOf(ref(entity, 'activeHead')?.ref),
        }))
}

test('active connectors tick every half beat except at active heads', () => {
    assert.deepEqual(
        hiddenTicks(
            chart([
                [
                    note(0.25),
                    note(1, { isAttached: true }),
                    note(1.5, { isConnectorSeparator: true, isAttached: false }),
                    note(2.5),
                ],
                // A fake or guide connector schedules nothing.
                [note(0, { connectorIsFake: true }), note(2)],
                [note(0, { connectorType: 'guide' }), note(2)],
            ]),
        ),
        [
            {
                archetype: 'TransientHiddenTickNote',
                beat: 0.5,
                attachHead: 0.25,
                attachTail: 1.5,
                activeHead: undefined,
            },
            {
                archetype: 'TransientHiddenTickNote',
                beat: 1,
                attachHead: 0.25,
                attachTail: 1.5,
                activeHead: undefined,
            },
            {
                archetype: 'TransientHiddenTickNote',
                beat: 1.5,
                attachHead: 1.5,
                attachTail: 2.5,
                activeHead: undefined,
            },
            {
                archetype: 'TransientHiddenTickNote',
                beat: 2,
                attachHead: 1.5,
                attachTail: 2.5,
                activeHead: undefined,
            },
        ],
    )
})

test('damage connectors skip the damage head and add a tick at the damage tail', () => {
    assert.deepEqual(
        hiddenTicks(
            chart([
                [
                    note(1, { connectorType: 'damage', noteType: 'damage' }),
                    note(1.75, { isConnectorSeparator: true, connectorType: 'damage' }),
                    note(2.25, { noteType: 'damage' }),
                ],
            ]),
        ),
        [
            {
                archetype: 'TransientHiddenDamageTickNote',
                beat: 1.5,
                attachHead: 1,
                attachTail: 1.75,
                activeHead: 1,
            },
            {
                archetype: 'TransientHiddenDamageTickNote',
                beat: 2,
                attachHead: 1.75,
                attachTail: 2.25,
                activeHead: 1,
            },
            {
                archetype: 'TransientHiddenDamageTickNote',
                beat: 2.25,
                attachHead: 1.75,
                attachTail: 2.25,
                activeHead: 1,
            },
        ],
    )
})

test('the preview overlay schedules exactly the hidden ticks that level data exports', () => {
    let count = 0
    for (const source of randomCharts()) {
        const state = createState(source, 0)
        const toTime = (beat: number) => beatToTime(state.bpms, beat)
        const { entities } = serializeToLevelData(
            state.initialLife,
            state.isDynamicStages,
            0,
            state.store,
            state.groups,
            state.stages,
        )
        const byName = new Map(
            entities.flatMap((entity) => (entity.name ? [[entity.name, entity]] : [])),
        )
        const exportedNote = (name: string | undefined) => {
            const entity = byName.get(name ?? '')
            assert.ok(entity)
            return [value(entity, '#BEAT'), value(entity, 'lane'), value(entity, 'size')]
        }
        const exported = entities
            .filter((entity) => entity.archetype.startsWith('TransientHidden'))
            .map((entity) => {
                const beat = value(entity, '#BEAT')
                const damage = entity.archetype === 'TransientHiddenDamageTickNote'
                const activeHead = ref(entity, 'activeHead')?.ref
                return {
                    damage,
                    target: toTime(beat),
                    drawStart: damage
                        ? toTime(
                              Math.max(
                                  damageTickInputStartBeat(beat),
                                  exportedNote(activeHead)[0] ?? -Infinity,
                              ),
                          )
                        : toTime(beat) - 5 / 60,
                    attachHead: exportedNote(ref(entity, 'attachHead')?.ref),
                    attachTail: exportedNote(ref(entity, 'attachTail')?.ref),
                }
            })

        const previewNote = (note: NoteEntity | undefined) => {
            assert.ok(note)
            return [note.beat, note.left + note.size / 2, note.size / 2]
        }
        const scheduled = buildPreviewChart(state, 10).chains.flatMap((chain) =>
            getHiddenTickHitboxes(chain).map((tick) => ({
                damage: !!tick.damageTick,
                target: tick.target,
                drawStart: tick.drawStart,
                attachHead: previewNote(tick.note.attachHead?.source),
                attachTail: previewNote(tick.note.attachTail?.source),
            })),
        )
        assert.deepEqual(scheduled, exported)
        count += scheduled.length
    }
    assert.ok(count > 1000)
})
