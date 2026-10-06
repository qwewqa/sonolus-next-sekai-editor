import assert from 'node:assert/strict'
import test from 'node:test'
import type { Chart } from '../../src/chart'
import type { GroupId } from '../../src/chart/groups'
import type { NoteObject } from '../../src/chart/note'
import type { StageId } from '../../src/chart/stages'
import type { TimeScaleEase } from '../../src/chart/timeScale'
import {
    easeFromValue,
    eases,
    easeValues,
    timeScaleEaseLevelDataValues,
    type Ease,
} from '../../src/ease'
import { serializeToLevelDataEntities } from '../../src/levelData/entities/serialize'
import { createState } from '../../src/state'

const groupId = 1 as GroupId
const stageId = 1 as StageId

const note = (beat: number, connectorEase: Ease): NoteObject => ({
    groupId,
    stageId,
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
    connectorEase,
    connectorIsFake: false,
    connectorActiveIsCritical: false,
    connectorGuideAlpha: 1,
    connectorLayer: 'top',
    connectorIsPassThrough: false,
    connectorPresentation: 'default',
})

const chart = (ease: TimeScaleEase): Chart => ({
    initialLife: 1000,
    isDynamicStages: true,
    bpms: [{ beat: 0, bpm: 120 }],
    groups: new Map([[groupId, { name: 'Default' }]]),
    stages: new Map([
        [
            stageId,
            { name: 'Stage', isFromStart: true, isUntilEnd: true, generateSimLines: 'global' },
        ],
    ]),
    cameraEvents: [
        {
            beat: 1,
            cameraLeft: -6,
            cameraSize: 12,
            cameraZoom: 1,
            cameraZoomTargetLane: 0,
            cameraZoomTargetY: 0,
            cameraZoomVerticalAlign: 'default',
            cameraRotation: 0,
            cameraStageTilt: 0,
            eventEase: ease,
        },
    ],
    stageMaskEvents: [
        { stageId, beat: 1, maskLeft: -6, maskSize: 12, isMaskNotes: false, eventEase: ease },
    ],
    stagePivotEvents: [
        {
            stageId,
            beat: 1,
            pivotLane: 0,
            divisionSize: 2,
            divisionParity: 'even',
            yOffset: 0,
            yOffsetBeat: 0,
            eventEase: ease,
        },
    ],
    stageStyleEvents: [
        {
            stageId,
            beat: 1,
            editorLane: 0,
            judgmentLineColor: 'neutral',
            judgmentLineStyle: 'default',
            leftBorderStyle: 'default',
            rightBorderStyle: 'default',
            isFullWidth: false,
            noteAlpha: 1,
            laneAlpha: 1,
            judgmentLineAlpha: 1,
            divisionLineAlpha: 1,
            eventEase: ease,
        },
    ],
    stageTransformEvents: [
        {
            stageId,
            beat: 1,
            rotation: 0,
            xTranslation: 0,
            yTranslation: 0,
            elevation: 0,
            anchor: 'default',
            eventEase: ease,
        },
    ],
    timeScales: [
        {
            groupId,
            beat: 1,
            editorLane: 0,
            timeScale: 2,
            skip: 0,
            timeScaleEase: ease,
            timeScaleTransition: 'timeScale',
            hideNotes: false,
        },
    ],
    slides: [[note(1, ease), note(2, ease)]],
})

const serialize = (source: Chart) => {
    const state = createState(source, 0)
    return serializeToLevelDataEntities(
        state.initialLife,
        state.isDynamicStages,
        state.store,
        state.groups,
        state.stages,
    )
}

const easeData = (entities: ReturnType<typeof serialize>) =>
    entities.flatMap((entity) =>
        entity.data.flatMap((data) =>
            ['connectorEase', 'ease', '#TIMESCALE_EASE'].includes(data.name) && 'value' in data
                ? [data]
                : [],
        ),
    )

test('None exports as NONE and In Step as IN_STEP', () => {
    // 2 connectors, 5 events and a time scale.
    for (const [ease, value] of [
        ['none', 0],
        ['inStep', 38],
    ] as const) {
        const data = easeData(serialize(chart(ease)))
        assert.equal(data.length, 8)
        assert.deepEqual(new Set(data.map((d) => d.value)), new Set([value]), ease)
    }
})

test('NONE imports as None and IN_STEP as In Step', () => {
    assert.equal(easeFromValue(0), 'none')
    assert.equal(easeFromValue(38), 'inStep')
    assert.ok(timeScaleEaseLevelDataValues.includes(0))
    assert.ok(timeScaleEaseLevelDataValues.includes(38))
})

test('every ease keeps its engine value', () => {
    for (const ease of eases) assert.equal(easeFromValue(easeValues[ease]), ease)
    for (const [ease, value] of [
        ['linear', 1],
        ['outInCirc', 29],
        ['outStep', 39],
        ['inOutStep', 40],
        ['outInStep', 41],
    ] as const) {
        const data = easeData(serialize(chart(ease)))
        assert.deepEqual(new Set(data.map((d) => d.value)), new Set([value]), ease)
    }
})
