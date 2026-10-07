import type { State } from '..'
import { attachEasedFrac, buildPreviewChart } from '../../preview/engine/chart'
import { getStageProps } from '../../preview/engine/stage'
import type { SlideId } from '../entities/slides'
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
        const headLane = head.lane + headStage.pivotLane
        const tailLane = tail.lane + tailStage.pivotLane
        const headElevation = (head.elevation ?? 0) + headStage.elevation
        const tailElevation = (tail.elevation ?? 0) + tailStage.elevation
        positions.set(note, {
            left: headLane + (tailLane - headLane) * frac - stage.pivotLane - compiled.size,
            size: compiled.size * 2,
            elevation: headElevation + (tailElevation - headElevation) * frac - stage.elevation,
        })
    }
    return positions
}

/** Each slide's kept notes; a tick losing its attach head or tail detaches where drawn, as Split Slide does. */
export const keepSlideNotes = (
    source: State,
    slideIds: SlideId[],
    isKept: (note: NoteEntity) => boolean,
) => {
    const infos = slideIds.map((id) => source.store.slides.info.get(id) ?? [])
    const detached = infos.flatMap((slide) =>
        slide
            .filter(
                ({ note, attachHead, attachTail }) =>
                    note.isAttached && isKept(note) && (!isKept(attachHead) || !isKept(attachTail)),
            )
            .map(({ note }) => note),
    )
    const positions = getMaterializedNotePositions(source, detached)
    return infos.map((slide) =>
        slide.flatMap(({ note }) => {
            if (!isKept(note)) return []
            const position = positions.get(note)
            return [position ? { ...note, ...position, isAttached: false } : note]
        }),
    )
}
