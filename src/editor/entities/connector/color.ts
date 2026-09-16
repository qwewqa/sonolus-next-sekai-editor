import { bpms } from '../../../history/bpms'
import type { NoteEntity } from '../../../state/entities/slides/note'
import { beatToTime } from '../../../state/integrals/bpms'
import { activeColors, damageColor, guideColors } from '../../../utils/colors'
import { remap } from '../../../utils/math'
import { getGuideFill, type ConnectorFill } from './guideFill'

export const getColor = (
    id: string,
    segmentHead: NoteEntity,
    segmentTail: NoteEntity,
    tHead: number,
    tTail: number,
): ConnectorFill => {
    if (segmentHead.connectorType !== 'guide')
        return {
            fill: {
                fill:
                    segmentHead.connectorType === 'damage'
                        ? damageColor
                        : activeColors[
                              segmentHead.connectorActiveIsCritical ? 'critical' : 'normal'
                          ],
                'fill-opacity': 0.8,
            },
        }

    const tSegmentHead = beatToTime(bpms.value, segmentHead.beat)
    const tSegmentTail = beatToTime(bpms.value, segmentTail.beat)

    return getGuideFill(
        id,
        guideColors[segmentHead.connectorGuideColor],
        remap(
            tSegmentHead,
            tSegmentTail,
            segmentHead.connectorGuideAlpha,
            segmentTail.connectorGuideAlpha,
            tHead,
        ) * 0.5,
        remap(
            tSegmentHead,
            tSegmentTail,
            segmentHead.connectorGuideAlpha,
            segmentTail.connectorGuideAlpha,
            tTail,
        ) * 0.5,
    )
}
