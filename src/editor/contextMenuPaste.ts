import { clipboardEntry, updateClipboard } from '../clipboard'
import { state } from '../history'
import { bpms } from '../history/bpms'
import { hasSameChartData } from '../state/data'
import { timeToBeat } from '../state/integrals/bpms'
import { align } from '../utils/math'
import type { Modifiers } from './controls/gestures/pointer'
import { pasteAtPosition } from './tools/paste'
import { view, xToLane, yToTime } from './view'

export const pasteAtContextPosition = async (
    x: number,
    y: number,
    modifiers: Modifiers = { ctrl: false, shift: false },
) => {
    const source = state.value
    const lane = xToLane(x)
    const beat = timeToBeat(bpms.value, Math.max(0, yToTime(y)))
    const { division, snapping, groupId, stageId } = view
    try {
        await updateClipboard()
    } catch {
        if (!clipboardEntry.value?.data) return false
    }

    const data = clipboardEntry.value?.data
    if (
        !hasSameChartData(source, state.value) ||
        view.groupId !== groupId ||
        view.stageId !== stageId ||
        !data
    )
        return false

    const beatOffset =
        snapping === 'absolute'
            ? align(beat, division) - data.beat
            : align(beat - data.beat, division)
    await pasteAtPosition(lane, beatOffset, modifiers)
    return true
}
