import type { State } from '..'
import { buildPreviewChart } from '../../preview/engine/chart'
import { getStageProps } from '../../preview/engine/stage'
import type { Entity } from '../entities'
import { createSlideId } from '../entities/slides'
import { beatToTime } from '../integrals/bpms'
import { addNote, removeNote } from '../mutations/slides/note'
import { createTransaction } from '../transaction'
import { connectorProperties } from './connectorProperties'
import { getMaterializedNotePositions } from './notePositions'

export const combineNotes = (source: State, selected: Entity[]): State => {
    const slideIds = new Set(
        selected.filter((entity) => entity.type === 'note').map((note) => note.slideId),
    )
    if (slideIds.size < 2) return source

    const unordered = [...source.store.slides.info]
        .filter(([id]) => slideIds.has(id))
        .flatMap(([, infos]) =>
            infos.map((info, index) => ({
                note: info.note,
                attached: info.note.isAttached && index > 0 && index < infos.length - 1,
                properties: connectorProperties(infos[index + 1]?.segmentHead ?? info.segmentHead),
            })),
        )
    const byBeat = new Map<number, Map<number, typeof unordered>>()
    for (const item of unordered) {
        const slides = byBeat.get(item.note.beat) ?? new Map<number, typeof unordered>()
        const block = slides.get(item.note.slideId) ?? []
        block.push(item)
        slides.set(item.note.slideId, block)
        byBeat.set(item.note.beat, slides)
    }
    const hasElevationTies = [...byBeat.values()].some((slides) => slides.size > 1)
    const chart =
        (source.isDynamicStages && hasElevationTies) || unordered.some(({ attached }) => attached)
            ? buildPreviewChart(source, 10)
            : undefined
    const stages = chart?.stages ?? []
    const positions = getMaterializedNotePositions(
        source,
        unordered.map(({ note }) => note),
        chart,
    )
    const stageIndexes = new Map([...source.stages.keys()].map((id, index) => [id, index]))
    const elevation = (item: (typeof unordered)[number] | undefined) => {
        if (!item) return 0
        const { note } = item
        const index = stageIndexes.get(note.stageId)
        const stage = index === undefined ? undefined : stages[index]
        return (
            (positions.get(note)?.elevation ?? note.elevation) +
            (stage ? getStageProps(stage, beatToTime(source.bpms, note.beat)).elevation : 0)
        )
    }
    const notes = [...byBeat]
        .sort(([a], [b]) => a - b)
        .flatMap(([, slides]) => {
            const blocks = [...slides.values()]
            if (blocks.length < 2) return blocks.flat()
            return blocks
                .map((notes) => ({ notes, elevation: elevation(notes[0]) }))
                .sort((a, b) => a.elevation - b.elevation)
                .flatMap(({ notes }) => notes)
        })

    const transaction = createTransaction(source)
    for (const { note } of notes) removeNote(transaction, note)

    const slideId = createSlideId()
    const combined = notes.flatMap(({ note, properties }, index) => {
        const previous = notes[index - 1]?.properties
        const changed = previous && JSON.stringify(previous) !== JSON.stringify(properties)
        return addNote(transaction, slideId, {
            ...note,
            ...positions.get(note),
            ...properties,
            // Interleaving another slide changes attachment anchors. Preserve
            // every note's current position instead of interpolating it again.
            isAttached: false,
            isConnectorSeparator: note.isConnectorSeparator || !!changed,
        })
    })
    return transaction.commit([...selected.filter((entity) => entity.type !== 'note'), ...combined])
}
