import type { SlideInfos } from '../../state/entities/slides/hiddenTicks'
import type { NoteEntity } from '../../state/entities/slides/note'
import { elevationGuideAlphaFraction } from '../../utils/guideAlpha'

const lookups = new WeakMap<SlideInfos, ReadonlyMap<NoteEntity, SlideInfos[number]>>()
const lookup = (infos: SlideInfos) => {
    let result = lookups.get(infos)
    if (!result) {
        result = new Map(infos.map((info) => [info.note, info]))
        lookups.set(infos, result)
    }
    return result
}

export const guideElevationFraction = (
    marker: NoteEntity,
    head: NoteEntity,
    tail: NoteEntity,
    infos?: SlideInfos,
) =>
    elevationGuideAlphaFraction(marker, head, tail, (note) => {
        const info = note.isAttached && infos ? lookup(infos).get(note) : undefined
        const attached = info && note !== info.attachHead && note !== info.attachTail
        return {
            beat: note.beat,
            elevation: note.elevation,
            attachHead: attached ? info.attachHead : undefined,
            attachTail: attached ? info.attachTail : undefined,
        }
    })
