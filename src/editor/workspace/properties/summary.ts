import type { Entity, EntityType } from '../../../state/entities'
import type { SlideId } from '../../../state/entities/slides'

/** Editable kinds in the order the summary lists them. */
const summaryKinds = [
    'note',
    'bpm',
    'timeScale',
    'cameraEventJoint',
    'stageMaskEventJoint',
    'stagePivotEventJoint',
    'stageStyleEventJoint',
    'stageTransformEventJoint',
] as const satisfies EntityType[]

export type SummaryKind = (typeof summaryKinds)[number]

export const summarizeSelection = (
    entities: readonly Entity[],
    slideLength: (slideId: SlideId) => number,
) => {
    const counts = new Map<EntityType, number>()
    const slides = new Set<SlideId>()
    for (const entity of entities) {
        counts.set(entity.type, (counts.get(entity.type) ?? 0) + 1)
        // Single notes are slides of one; only longer slides count.
        if (entity.type === 'note' && slideLength(entity.slideId) > 1) slides.add(entity.slideId)
    }
    return {
        kinds: summaryKinds.flatMap((kind) => {
            const count = counts.get(kind)
            return count ? [{ kind, count }] : []
        }),
        slides: slides.size,
    }
}
