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
    // Rounds to the shown thousandth first, so 3.9999 reads 2.1 rather than 1.5.
    if (fractional) chartBeat = Math.round(chartBeat * 1000) / 1000
    const beat = toDisplayedBeat(chartBeat)
    const beatText = fractional ? beat.toFixed(3) : `${beat}`
    if (display === 'beat') return beatText
    const position = beatToMeasure(bpms, chartBeat)
    const measureBeat = position.beat.toFixed(3)
    const measureText = `${position.measure}.${fractional ? measureBeat : Number(measureBeat)}`
    return display === 'both' ? `${measureText} (${beatText})` : measureText
}
