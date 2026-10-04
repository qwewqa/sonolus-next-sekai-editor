import { beatToMeasure, type BpmIntegral } from '../state/integrals/bpms'

export type BeatDisplay = 'beat' | 'measure' | 'both'

export const toDisplayedBeat = (chartBeat: number) => chartBeat + 1
export const fromDisplayedBeat = (displayedBeat: number) => displayedBeat - 1

export const formatBeatPosition = (
    bpms: BpmIntegral[],
    chartBeat: number,
    display: BeatDisplay,
    fractional = false,
) => {
    const beat = toDisplayedBeat(chartBeat)
    const beatText = fractional ? beat.toFixed(3) : `${beat}`
    if (display === 'beat') return beatText
    const position = beatToMeasure(bpms, chartBeat)
    const measureText = `${position.measure}.${Number(position.beat.toFixed(3))}`
    return display === 'both' ? `${measureText} (${beatText})` : measureText
}
