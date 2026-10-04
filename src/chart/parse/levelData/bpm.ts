import { EngineArchetypeDataName, EngineArchetypeName } from '@sonolus/core'
import Type from 'typebox'
import { getOptionalValue, getValue, type ParseCtx } from '.'
import { beatSchema } from './schemas'

export const parseBpmsToChart = ({ chart, entities }: ParseCtx) => {
    for (const entity of entities) {
        if (entity.archetype !== EngineArchetypeName.BpmChange) continue

        chart.bpms.push({
            beat: getValue(entity, EngineArchetypeDataName.Beat, beatSchema),
            bpm: getValue(entity, EngineArchetypeDataName.Bpm, valueSchema),
            meter: getOptionalValue(entity, 'meter', valueSchema) ?? 4,
        })
    }
}

const valueSchema = Type.Number({ exclusiveMinimum: 0 })
