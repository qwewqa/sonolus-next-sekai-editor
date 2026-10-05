import { EngineArchetypeDataName, EngineArchetypeName } from '@sonolus/core'
import Type from 'typebox'
import { getOptionalValue, getValue, type ParseCtx } from '.'
import { easeFromValue, timeScaleEaseLevelDataValues, type TimeScaleEase } from '../../../ease'
import { beatSchema } from './schemas'

export const parseTimeScalesToChart = ({ chart, entities, getGroupId }: ParseCtx) => {
    for (const entity of entities) {
        if (entity.archetype !== EngineArchetypeName.TimeScaleChange) continue

        chart.timeScales.push({
            groupId: getGroupId(entity),
            beat: getValue(entity, EngineArchetypeDataName.Beat, beatSchema),
            editorLane: getOptionalValue(entity, 'editorLane', editorLaneSchema) ?? -6,
            timeScale: getValue(entity, EngineArchetypeDataName.TimeScale, valueSchema),
            skip: getValue(entity, '#TIMESCALE_SKIP', skipSchema),
            timeScaleEase: easeFromValue(
                getValue(entity, '#TIMESCALE_EASE', easeSchema),
            ) as TimeScaleEase,
            timeScaleTransition:
                timeScaleTransitions[
                    getOptionalValue(entity, 'transitionStyle', transitionStyleSchema) ?? 0
                ],
            hideNotes: !!getOptionalValue(entity, 'hideNotes', hideNotesSchema),
        })
    }
}

const editorLaneSchema = Type.Number()

const valueSchema = Type.Number()

const skipSchema = Type.Number()

const easeSchema = Type.Union(timeScaleEaseLevelDataValues.map((value) => Type.Literal(value)))

const transitionStyleSchema = Type.Union([Type.Literal(0), Type.Literal(1)])

const timeScaleTransitions = {
    0: 'timeScale',
    1: 'scroll',
} as const

const hideNotesSchema = Type.Number()
