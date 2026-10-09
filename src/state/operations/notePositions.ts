import type { State } from '..'
import { attachEasedFrac, buildPreviewChart } from '../../preview/engine/chart'
import { getStageProps } from '../../preview/engine/stage'
import { alignComputed } from '../../utils/math'
import { sameBeatAttachmentFraction } from '../entities/slides/attachment'
import type { NoteEntity } from '../entities/slides/note'

export const getMaterializedNotePositions = (
    source: State,
    notes: NoteEntity[],
    compiledChart?: ReturnType<typeof buildPreviewChart>,
) => {
    const attached = notes.filter((note) => {
        const slide = source.store.slides.note.get(note.slideId)
        return note.isAttached && slide?.[0] !== note && slide?.at(-1) !== note
    })
    const positions = new Map<NoteEntity, { left: number; size: number; elevation: number }>()
    if (!attached.length) return positions
    const chart = compiledChart ?? buildPreviewChart(source, 10)
    const bySource = new Map(
        chart.notes.flatMap((note) => (note.source ? [[note.source, note] as const] : [])),
    )
    for (const note of attached) {
        const compiled = bySource.get(note)
        if (!compiled?.isAttached || !compiled.attachHead || !compiled.attachTail) continue
        const props = (index: number) => {
            const stage = chart.stages[index]
            return stage
                ? getStageProps(stage, compiled.targetTime)
                : { pivotLane: 0, elevation: 0 }
        }
        const head = compiled.attachHead
        const tail = compiled.attachTail
        const headStage = props(head.stageIndex)
        const tailStage = props(tail.stageIndex)
        const stage = props(compiled.stageIndex)
        const frac = attachEasedFrac(compiled)
        const elevationFrac =
            (head.source &&
                tail.source &&
                sameBeatAttachmentFraction(head.source, tail.source, note)) ??
            frac
        const headLane = head.lane + headStage.pivotLane
        const tailLane = tail.lane + tailStage.pivotLane
        const headElevation = (head.elevation ?? 0) + headStage.elevation
        const tailElevation = (tail.elevation ?? 0) + tailStage.elevation
        positions.set(note, {
            left: alignComputed(
                headLane + (tailLane - headLane) * frac - stage.pivotLane - compiled.size,
            ),
            size: alignComputed(compiled.size * 2),
            elevation:
                headElevation + (tailElevation - headElevation) * elevationFrac - stage.elevation,
        })
    }
    return positions
}
