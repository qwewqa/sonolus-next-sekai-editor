import type { Chart } from '.'
import { ImportRefusal } from './refusal'

export const validateChart = (chart: Chart) => {
    if (!chart.bpms.some(({ beat }) => beat === 0)) throw new ImportRefusal('initialBpm')

    // Level data refuses these, so the editor could not reopen its own file.
    const notes = chart.slides.flat()
    const objects = [
        ...chart.bpms,
        ...chart.timeScales,
        ...chart.cameraEvents,
        ...chart.stageMaskEvents,
        ...chart.stagePivotEvents,
        ...chart.stageStyleEvents,
        ...chart.stageTransformEvents,
        ...notes,
    ]
    if (objects.some(({ beat }) => beat < 0)) throw new ImportRefusal('negativeBeat')
    if (notes.some(({ size }) => size < 0)) throw new ImportRefusal('negativeNoteSize')
    if (chart.bpms.some(({ bpm }) => !(bpm > 0 && Number.isFinite(bpm))))
        throw new ImportRefusal('invalidBpm')
    // NaN and infinities save as null.
    for (const object of objects) {
        for (const [name, value] of Object.entries(object)) {
            if (typeof value !== 'number' || Number.isFinite(value)) continue
            throw new ImportRefusal('invalidValue', name)
        }
    }
}
