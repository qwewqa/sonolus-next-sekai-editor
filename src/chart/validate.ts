import type { Chart } from '.'

export const validateChart = (chart: Chart) => {
    if (!chart.bpms.some(({ beat }) => beat === 0))
        throw new Error('Invalid level: initial BPM not found')

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
    if (objects.some(({ beat }) => beat < 0)) throw new Error('Invalid level: negative beat')
    if (notes.some(({ size }) => size < 0)) throw new Error('Invalid level: negative note size')
    if (chart.bpms.some(({ bpm }) => !(bpm > 0 && Number.isFinite(bpm))))
        throw new Error('Invalid level: BPM must be positive and finite')
}
