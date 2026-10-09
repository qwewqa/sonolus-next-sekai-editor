import { elevationGuideAlphaFraction } from '../../utils/guideAlpha'
import {
    blendStageTransform,
    computeStageTransform,
    type LayoutTransform,
    type PreviewViewport,
} from './layout'
import { ease, lerp, safeUnlerpClamped } from './math'
import type { PreviewNote } from './model'
import type { StageProps } from './stage'

/** Authored beats, rather than times or scroll progress that can collapse. */
export const sameAuthoredBeat = (head: PreviewNote, tail: PreviewNote) => {
    const beat = head.source?.beat ?? head.beat
    return beat !== undefined && beat === (tail.source?.beat ?? tail.beat)
}

export const previewGuideAlphaFraction = (
    note: PreviewNote,
    segmentHead: PreviewNote,
    segmentTail: PreviewNote,
) =>
    elevationGuideAlphaFraction(note, segmentHead, segmentTail, (marker) => ({
        beat: marker.source?.beat ?? marker.beat,
        elevation: marker.elevation ?? 0,
        attachHead: marker.isAttached ? marker.attachHead : undefined,
        attachTail: marker.isAttached ? marker.attachTail : undefined,
    }))

export const usesLocalElevationEase = (head: PreviewNote, tail: PreviewNote) =>
    sameAuthoredBeat(head, tail) &&
    !sameAuthoredBeat(
        head.isAttached && head.attachHead ? head.attachHead : head,
        tail.isAttached && tail.attachTail ? tail.attachTail : tail,
    )

export const previewAttachmentFrac = (
    note: PreviewNote,
    head = note.attachHead,
    tail = note.attachTail,
) => {
    if (!head || !tail) return 0
    return sameAuthoredBeat(head, tail)
        ? safeUnlerpClamped(head.elevation ?? 0, tail.elevation ?? 0, note.elevation ?? 0)
        : safeUnlerpClamped(head.targetTime, tail.targetTime, note.targetTime)
}

type StagePropsAt = (stageIndex: number) => StageProps | undefined

export const effectiveNoteElevation = (note: PreviewNote, propsAt: StagePropsAt): number => {
    const { attachHead, attachTail } = note
    if (note.isAttached && attachHead && attachTail) {
        const fraction = previewAttachmentFrac(note)
        return lerp(
            effectiveNoteElevation(attachHead, propsAt),
            effectiveNoteElevation(attachTail, propsAt),
            sameAuthoredBeat(attachHead, attachTail)
                ? fraction
                : ease(attachHead.connectorEase, fraction),
        )
    }
    return (propsAt(note.stageIndex)?.elevation ?? 0) + (note.elevation ?? 0)
}

/** Preserve an attached endpoint's inherited stage geometry at a common height. */
export const noteTransformAtElevation = (
    viewport: PreviewViewport,
    camera: LayoutTransform,
    note: PreviewNote,
    propsAt: StagePropsAt,
    elevation: number,
): ReturnType<typeof computeStageTransform> => {
    const { attachHead, attachTail } = note
    if (note.isAttached && attachHead && attachTail) {
        const fraction = ease(attachHead.connectorEase, previewAttachmentFrac(note))
        let headElevation = elevation
        let tailElevation = elevation
        if (!sameAuthoredBeat(attachHead, attachTail)) {
            // Preserve the legacy endpoint's two distinct projections. Changing
            // its height translates both parent heights by the same amount.
            const first = effectiveNoteElevation(attachHead, propsAt)
            const last = effectiveNoteElevation(attachTail, propsAt)
            const delta = elevation - lerp(first, last, fraction)
            headElevation = first + delta
            tailElevation = last + delta
        }
        return blendStageTransform(
            noteTransformAtElevation(viewport, camera, attachHead, propsAt, headElevation),
            noteTransformAtElevation(viewport, camera, attachTail, propsAt, tailElevation),
            fraction,
        )
    }
    const props = noteElevationTransform(propsAt(note.stageIndex))
    return computeStageTransform(
        viewport,
        camera,
        props.rotate,
        props.xLaneTranslate,
        props.yLaneTranslate,
        props.lane,
        props.centerWeight,
        elevation,
    )
}

export type ElevationTransform = Pick<
    StageProps,
    'rotate' | 'xLaneTranslate' | 'yLaneTranslate' | 'lane' | 'centerWeight' | 'elevation'
>

export const noteElevationTransform = (
    props: StageProps | undefined,
    elevation = 0,
): ElevationTransform => ({
    rotate: props?.rotate ?? 0,
    xLaneTranslate: props?.xLaneTranslate ?? 0,
    yLaneTranslate: props?.yLaneTranslate ?? 0,
    lane: props?.lane ?? 0,
    centerWeight: props?.centerWeight ?? 0,
    elevation: (props?.elevation ?? 0) + elevation,
})

/** Elevation follows its own linear axis while the stage geometry follows easing. */
export const blendElevationTransform = (
    viewport: PreviewViewport,
    camera: LayoutTransform,
    head: ElevationTransform,
    tail: ElevationTransform,
    geometryFrac: number,
    elevationFrac: number,
) => {
    const elevation = lerp(head.elevation, tail.elevation, elevationFrac)
    const at = (props: ElevationTransform) =>
        computeStageTransform(
            viewport,
            camera,
            props.rotate,
            props.xLaneTranslate,
            props.yLaneTranslate,
            props.lane,
            props.centerWeight,
            elevation,
        )
    // Recompute the projected rotation center too, including the elevation cap.
    return blendStageTransform(at(head), at(tail), geometryFrac)
}
