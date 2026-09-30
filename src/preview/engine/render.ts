import type { PreviewRenderer, ZKey } from '../gl'
import type { NoteParticleSet, PreviewParticle } from '../particle'
import { getStyledParticle } from '../particle'
import type { PreviewSkin } from '../skin'
import { getStyledSkin } from '../skin'
import { layoutBackground } from './background'
import { attachEasedFrac } from './chart'
import { ConnectorVisualState, drawConnector, type ConnectorEndpoint } from './connector'
import type { PreviewFrameContext } from './context'
import {
    CONNECTOR_THROUGH_JUDGE_LINE_DESPAWN_DELAY,
    MAX_HIT_EFFECT_DURATION,
    SLIDE_EFFECT_DESPAWN_DELAY,
    getFrameIndex,
    latestVisibleTarget,
    queryGroupTimeIndex,
} from './frameIndex'
import { LAYER_SLOT_EFFECT, LAYER_SLOT_GLOW_EFFECT, getZ } from './layer'
import {
    FlickDirection,
    approach,
    blendStageTransform,
    createLayout,
    createViewport,
    defaultCameraInfo,
    getCameraInfo,
    identityStageScreenTransform,
    identityStageTransform,
    iterSlotLanes,
    layoutCircularEffect,
    layoutLinearEffect,
    layoutParticleLane,
    layoutRotatedLinearEffect,
    layoutSlotEffect,
    layoutSlotGlowEffect,
    layoutTickEffect,
    stageTransformToAffineOrIdentity,
    transformBillboard,
    transformedVecAt,
    type FlickDirectionValue,
    type StageScreenTransform,
    type StageTransform,
} from './layout'
import { interpolateVisualMasks, maskedNoteExtents, noVisualMask, type VisualMask } from './mask'
import { ease, lerp, remapClamped, transformQuadAffine, unlerpClamped, type Quad } from './math'
import {
    ConnectorKind,
    NoteKind,
    isActiveConnectorKind,
    type NoteKindValue,
    type PreviewChart,
    type PreviewNote,
} from './model'
import { drawNote, drawSlideNoteHead, getNoteSpriteSet } from './note'
import { LANE_PARTICLE_LAYER, PARTICLE_LAYER, drawParticleEffect, hashSeed } from './particleDraw'
import { drawSimLine } from './simLine'
import { findSlideConnector } from './slide'
import {
    drawStageWithProps,
    drawStaticStage,
    getStageProps,
    resolveJudgeLineStyle,
    stagePropsHasTransform,
    stagePropsTransform,
    type StageProps,
} from './stage'
import { queryTimeIndex } from './timeIndex'
import { hideNotesAt, noteDistance, preemptTime } from './timescale'

const LINEAR_EFFECT_DURATION = 0.5
const CIRCULAR_EFFECT_DURATION = 0.6
const DIRECTIONAL_EFFECT_DURATION = 0.32
const TICK_EFFECT_DURATION = 0.6
const LANE_EFFECT_DURATION = 1
const LANE_BASIC_EFFECT_DURATION = 0.3
const SLOT_EFFECT_DURATION = 0.5
const SLOT_GLOW_EFFECT_DURATION = 0.25
const CONNECTOR_TRAIL_SPAWN_PERIOD = 0.1
const CONNECTOR_SLOT_SPAWN_PERIOD = 0.2
const CONNECTOR_LOOP_DURATION = 1

const isUpDirection = (direction: FlickDirectionValue) =>
    direction === FlickDirection.upOmni ||
    direction === FlickDirection.upLeft ||
    direction === FlickDirection.upRight

const getNoteParticleSet = (
    particle: PreviewParticle,
    kind: NoteKindValue,
    isCritical: boolean,
    direction: FlickDirectionValue,
): NoteParticleSet | undefined => {
    switch (kind) {
        case NoteKind.tap:
            return isCritical ? particle.criticalNote : particle.normalNote
        case NoteKind.release:
        case NoteKind.headTap:
        case NoteKind.headRelease:
        case NoteKind.tailTap:
        case NoteKind.tailRelease:
            return isCritical ? particle.criticalSlideNote : particle.slideNote
        case NoteKind.flick:
        case NoteKind.headFlick:
        case NoteKind.tailFlick:
            if (isUpDirection(direction)) {
                return isCritical ? particle.criticalFlickNote : particle.flickNote
            }
            return isCritical ? particle.criticalDownFlickNote : particle.downFlickNote
        case NoteKind.trace:
        case NoteKind.headTrace:
        case NoteKind.tailTrace:
            return isCritical ? particle.criticalTraceNote : particle.traceNote
        case NoteKind.traceFlick:
        case NoteKind.headTraceFlick:
        case NoteKind.tailTraceFlick:
            if (isUpDirection(direction)) {
                return isCritical ? particle.criticalTraceFlickNote : particle.traceFlickNote
            }
            return isCritical ? particle.criticalTraceDownFlickNote : particle.traceDownFlickNote
        case NoteKind.tick:
            return isCritical ? particle.criticalSlideTickNote : particle.normalSlideTickNote
        case NoteKind.damage:
            return particle.damageNote
        case NoteKind.anchor:
        case NoteKind.hideTick:
            return undefined
    }
}

const isFlickBodyKind = (kind: NoteKindValue) =>
    kind === NoteKind.flick || kind === NoteKind.headFlick || kind === NoteKind.tailFlick

const directionShear = (direction: FlickDirectionValue) => {
    if (direction === FlickDirection.upLeft || direction === FlickDirection.downRight) return -1
    if (direction === FlickDirection.upRight || direction === FlickDirection.downLeft) return 1
    return 0
}

export const renderPreviewFrame = (
    renderer: PreviewRenderer,
    skin: PreviewSkin,
    chart: PreviewChart,
    now: number,
    width: number,
    height: number,
    displayWidth: number,
    displayHeight: number,
    noteSpeed: number,
    showEffects: boolean,
    particle?: PreviewParticle,
) => {
    const viewport = createViewport(displayWidth, displayHeight)
    const camera = chart.isDynamicStages
        ? getCameraInfo(viewport, chart.cameras, now)
        : defaultCameraInfo()
    const context: PreviewFrameContext = {
        now,
        layout: createLayout(viewport, camera, chart.isDynamicStages),
    }

    renderer.begin(width, height, displayWidth / displayHeight)
    const draw = renderer.draw

    const hideNotes = chart.groups.map((group) => hideNotesAt(group, now))
    const preempts = chart.groups.map((group) => preemptTime(noteSpeed, group.forceNoteSpeed))

    const stageProps: StageProps[] = chart.stages.map((stage) => getStageProps(stage, now))
    const stageTransforms: StageTransform[] = stageProps.map((props) =>
        stagePropsHasTransform(props)
            ? stagePropsTransform(context, props)
            : identityStageTransform,
    )
    const stageAffines: StageScreenTransform[] = stageTransforms.map((transform) =>
        stageTransformToAffineOrIdentity(transform),
    )
    const frameIndex = getFrameIndex(chart)
    const minimumYOffset = stageProps.reduce(
        (minimum, props) => Math.min(minimum, props.yOffset),
        0,
    )
    const defaultPreempt = preemptTime(noteSpeed, 0)
    const latestTargets = frameIndex.minimumTimescales.map((minimumTimescale, index) =>
        latestVisibleTarget(
            now,
            minimumTimescale,
            preempts[index] ?? defaultPreempt,
            context.layout.progressStart,
            minimumYOffset,
        ),
    )
    const fallbackLatestTarget = latestVisibleTarget(
        now,
        1,
        defaultPreempt,
        context.layout.progressStart,
        minimumYOffset,
    )

    if (chart.isDynamicStages) {
        for (const [i, stage] of chart.stages.entries()) {
            if (now < stage.drawStartTime || now > stage.drawEndTime) continue

            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            drawStageWithProps(context, draw, skin, stageProps[i]!)
        }
    } else {
        drawStaticStage(context, draw, skin)
    }

    const groupPreempt = (note: PreviewNote) =>
        preempts[note.groupIndex] ?? preemptTime(noteSpeed, 0)
    const groupHidesNotes = (note: PreviewNote) => hideNotes[note.groupIndex] ?? false
    const groupHidesNotesAt = (note: PreviewNote, t: number) => {
        const group = chart.groups[note.groupIndex]
        return group ? hideNotesAt(group, t) : false
    }

    const basicVisualLane = (note: PreviewNote) =>
        note.stageIndex >= 0 ? (stageProps[note.stageIndex]?.pivotLane ?? 0) + note.lane : note.lane

    const visualLane = (note: PreviewNote): number => {
        if (note.isAttached && note.attachHead && note.attachTail) {
            return lerp(
                basicVisualLane(note.attachHead),
                basicVisualLane(note.attachTail),
                attachEasedFrac(note),
            )
        }
        return basicVisualLane(note)
    }

    const basicYOffset = (note: PreviewNote) =>
        note.stageIndex >= 0 ? (stageProps[note.stageIndex]?.yOffset ?? 0) : 0

    const visualYOffset = (note: PreviewNote): number => {
        if (note.isAttached && note.attachHead && note.attachTail) {
            return remapClamped(
                note.attachHead.targetTime,
                note.attachTail.targetTime,
                basicYOffset(note.attachHead),
                basicYOffset(note.attachTail),
                note.targetTime,
            )
        }
        return basicYOffset(note)
    }

    const basicVisualNoteAlpha = (note: PreviewNote) =>
        note.stageIndex >= 0 ? (stageProps[note.stageIndex]?.noteAlpha ?? 1) : 1

    const visualNoteAlpha = (note: PreviewNote): number => {
        if (note.isAttached && note.attachHead && note.attachTail) {
            return remapClamped(
                note.attachHead.targetTime,
                note.attachTail.targetTime,
                basicVisualNoteAlpha(note.attachHead),
                basicVisualNoteAlpha(note.attachTail),
                note.targetTime,
            )
        }
        return basicVisualNoteAlpha(note)
    }

    const basicStageTransform = (note: PreviewNote): StageTransform =>
        note.stageIndex >= 0
            ? (stageTransforms[note.stageIndex] ?? identityStageTransform)
            : identityStageTransform

    const visualStageTransform = (note: PreviewNote): StageTransform => {
        if (note.isAttached && note.attachHead && note.attachTail) {
            return blendStageTransform(
                basicStageTransform(note.attachHead),
                basicStageTransform(note.attachTail),
                attachEasedFrac(note),
            )
        }
        return basicStageTransform(note)
    }

    const visualStageAffine = (note: PreviewNote): StageScreenTransform => {
        if (!chart.isDynamicStages) return identityStageScreenTransform
        if (note.isAttached && note.attachHead && note.attachTail) {
            return stageTransformToAffineOrIdentity(visualStageTransform(note))
        }
        return note.stageIndex >= 0
            ? (stageAffines[note.stageIndex] ?? identityStageScreenTransform)
            : identityStageScreenTransform
    }

    const basicProgress = (note: PreviewNote) => {
        const group = chart.groups[note.groupIndex]
        const distance = group ? noteDistance(group, now, note.targetTime) : note.targetTime - now
        return 1 - distance / groupPreempt(note)
    }

    const noteProgress = (note: PreviewNote): number => {
        if (note.isAttached && note.attachHead && note.attachTail) {
            const head = note.attachHead
            const tail = note.attachTail
            const headProgress = now < head.targetTime ? basicProgress(head) : 1
            const tailProgress = basicProgress(tail)
            const headFrac =
                now < head.targetTime ? 0 : unlerpClamped(head.targetTime, tail.targetTime, now)
            const frac = unlerpClamped(head.targetTime, tail.targetTime, note.targetTime)
            return remapClamped(headFrac, 1, headProgress, tailProgress, frac)
        }
        return basicProgress(note)
    }

    const visualProgress = (note: PreviewNote) => noteProgress(note) - visualYOffset(note)

    const headEaseFrac = (note: PreviewNote) =>
        note.isAttached && note.attachHead && note.attachTail
            ? unlerpClamped(note.attachHead.targetTime, note.attachTail.targetTime, note.targetTime)
            : 0

    const tailEaseFrac = (note: PreviewNote) =>
        note.isAttached && note.attachHead && note.attachTail
            ? unlerpClamped(note.attachHead.targetTime, note.attachTail.targetTime, note.targetTime)
            : 1

    const effectiveAttachHead = (note: PreviewNote) =>
        note.isAttached && note.attachHead ? note.attachHead : note

    const effectiveAttachTail = (note: PreviewNote) =>
        note.isAttached && note.attachTail ? note.attachTail : note

    const historicalStageProps: (Map<number, StageProps> | undefined)[] = []
    const stagePropsAtTime = (stageIndex: number, t: number): StageProps | undefined => {
        const stage = stageIndex >= 0 ? chart.stages[stageIndex] : undefined
        if (!stage) return undefined
        if (t === now) return stageProps[stageIndex]

        const cache = (historicalStageProps[stageIndex] ??= new Map<number, StageProps>())
        let props = cache.get(t)
        if (!props) {
            props = getStageProps(stage, t)
            cache.set(t, props)
        }
        return props
    }

    const basicVisualMaskAt = (note: PreviewNote, t: number): VisualMask => {
        const props = t === now ? stageProps[note.stageIndex] : stagePropsAtTime(note.stageIndex, t)
        return props?.maskNotes
            ? {
                  enabled: true,
                  left: props.lane - props.width,
                  right: props.lane + props.width,
                  stageIndex: note.stageIndex,
              }
            : noVisualMask
    }

    const visualMaskAt = (note: PreviewNote, t: number): VisualMask =>
        note.isAttached && note.attachHead && note.attachTail
            ? interpolateVisualMasks(
                  basicVisualMaskAt(note.attachHead, t),
                  basicVisualMaskAt(note.attachTail, t),
                  attachEasedFrac(note),
              )
            : basicVisualMaskAt(note, t)

    const basicVisualLaneAt = (note: PreviewNote, t: number) =>
        (stagePropsAtTime(note.stageIndex, t)?.pivotLane ?? 0) + note.lane

    const basicYOffsetAt = (note: PreviewNote, t: number) =>
        stagePropsAtTime(note.stageIndex, t)?.yOffset ?? 0

    const yOffsetAt = (note: PreviewNote, t: number): number => {
        if (note.isAttached && note.attachHead && note.attachTail) {
            return remapClamped(
                note.attachHead.targetTime,
                note.attachTail.targetTime,
                basicYOffsetAt(note.attachHead, t),
                basicYOffsetAt(note.attachTail, t),
                note.targetTime,
            )
        }
        return basicYOffsetAt(note, t)
    }

    const basicStageTransformAt = (
        context: PreviewFrameContext,
        note: PreviewNote,
        t: number,
    ): StageTransform => {
        const props = stagePropsAtTime(note.stageIndex, t)
        return props && stagePropsHasTransform(props)
            ? stagePropsTransform(context, props)
            : identityStageTransform
    }

    const visualStageTransformAt = (
        context: PreviewFrameContext,
        note: PreviewNote,
        t: number,
    ): StageTransform => {
        if (!chart.isDynamicStages) return identityStageTransform
        if (note.isAttached && note.attachHead && note.attachTail) {
            return blendStageTransform(
                basicStageTransformAt(context, note.attachHead, t),
                basicStageTransformAt(context, note.attachTail, t),
                attachEasedFrac(note),
            )
        }
        return basicStageTransformAt(context, note, t)
    }

    const withLayoutAt = (t: number, fn: (context: PreviewFrameContext) => void) => {
        if (!chart.isDynamicStages || !chart.cameras.length || t === now) {
            fn(context)
            return
        }
        fn({
            now,
            layout: createLayout(
                viewport,
                getCameraInfo(viewport, chart.cameras, t),
                chart.isDynamicStages,
            ),
        })
    }

    let particleOrder = 0
    const nextParticleZ = (layer = PARTICLE_LAYER): ZKey => [layer, particleOrder++]

    for (const { item: connector } of queryGroupTimeIndex(
        frameIndex.connectors,
        now,
        latestTargets,
        fallbackLatestTarget,
    )) {
        const { head, tail, segmentHead, segmentTail } = connector

        const endTime =
            Math.max(head.targetTime, tail.targetTime) +
            (connector.throughJudgeLine ? CONNECTOR_THROUGH_JUDGE_LINE_DESPAWN_DELAY : 0)
        if (now >= endTime) continue

        if (groupHidesNotes(segmentHead)) continue

        if (connector.activeTail && now >= connector.activeTail.targetTime) continue

        let visualState
        if (connector.kind === ConnectorKind.damage) {
            visualState = ConnectorVisualState.waiting
        } else if (connector.activeHead) {
            visualState =
                now < connector.activeHead.targetTime
                    ? ConnectorVisualState.waiting
                    : ConnectorVisualState.active
        } else {
            visualState = ConnectorVisualState.waiting
        }

        const tailEndpoint: ConnectorEndpoint = {
            lane: visualLane(tail),
            size: tail.size,
            visualProgress: visualProgress(tail),
            targetTime: tail.targetTime,
            easeFrac: tailEaseFrac(tail),
            transform: visualStageTransform(tail),
            mask: visualMaskAt(tail, now),
        }
        const tailNoteAlpha = visualNoteAlpha(tail)

        let headEndpoint: ConnectorEndpoint
        let headNoteAlpha: number
        if (now >= head.targetTime && !connector.throughJudgeLine) {
            const headVisualProgress =
                1 -
                remapClamped(
                    head.targetTime,
                    tail.targetTime,
                    visualYOffset(head),
                    visualYOffset(tail),
                    now,
                )
            headNoteAlpha = remapClamped(
                head.targetTime,
                tail.targetTime,
                visualNoteAlpha(head),
                tailNoteAlpha,
                now,
            )
            if (connector.ease === 0) {
                headEndpoint = {
                    lane: visualLane(head),
                    size: head.size,
                    visualProgress: headVisualProgress,
                    targetTime: now,
                    easeFrac: headEaseFrac(head),
                    transform: visualStageTransform(head),
                    mask: visualMaskAt(head, now),
                }
            } else {
                const currentEaseFrac = remapClamped(
                    head.targetTime,
                    tail.targetTime,
                    headEaseFrac(head),
                    tailEaseFrac(tail),
                    now,
                )
                const easedHead = ease(connector.ease, headEaseFrac(head))
                const easedTail = ease(connector.ease, tailEaseFrac(tail))
                const headInterpFrac =
                    Math.abs(easedHead - easedTail) < 1e-6
                        ? unlerpClamped(head.targetTime, tail.targetTime, now)
                        : unlerpClamped(easedHead, easedTail, ease(connector.ease, currentEaseFrac))
                headEndpoint = {
                    lane: lerp(visualLane(head), visualLane(tail), headInterpFrac),
                    size: lerp(head.size, tail.size, headInterpFrac),
                    visualProgress: headVisualProgress,
                    targetTime: now,
                    easeFrac: currentEaseFrac,
                    transform: blendStageTransform(
                        visualStageTransform(head),
                        visualStageTransform(tail),
                        headInterpFrac,
                    ),
                    mask: interpolateVisualMasks(
                        visualMaskAt(head, now),
                        visualMaskAt(tail, now),
                        headInterpFrac,
                    ),
                }
            }
        } else {
            headNoteAlpha = visualNoteAlpha(head)
            headEndpoint = {
                lane: visualLane(head),
                size: head.size,
                visualProgress: visualProgress(head),
                targetTime: head.targetTime,
                easeFrac: headEaseFrac(head),
                transform: visualStageTransform(head),
                mask: visualMaskAt(head, now),
            }
        }

        drawConnector(
            context,
            draw,
            getStyledSkin(skin, connector.style),
            connector.kind,
            visualState,
            connector.ease,
            headEndpoint,
            tailEndpoint,
            segmentHead.targetTime,
            basicVisualLane(segmentHead),
            connector.segmentHeadAlpha,
            segmentTail.targetTime,
            connector.segmentTailAlpha,
            headNoteAlpha,
            tailNoteAlpha,
            connector.layer,
            connector.fullScreen,
            connector.throughJudgeLine,
        )
    }

    for (const { item: note } of queryGroupTimeIndex(
        frameIndex.notes,
        now,
        latestTargets,
        fallbackLatestTarget,
    )) {
        if (now >= note.targetTime) continue
        if (note.kind === NoteKind.anchor || note.kind === NoteKind.hideTick) continue
        if (groupHidesNotes(note)) continue

        drawNote(
            context,
            draw,
            skin,
            note.kind,
            note.isCritical,
            visualLane(note),
            note.size,
            visualProgress(note),
            note.direction,
            note.targetTime,
            visualStageAffine(note),
            visualNoteAlpha(note),
            visualMaskAt(note, now),
            note.style,
        )
    }

    for (const { item: slide, index: slideIndex } of queryTimeIndex(frameIndex.slides, now, now)) {
        const start = slide.activeHead.targetTime
        const end = slide.activeTail.targetTime
        if (now < start) continue
        if (now >= end + SLIDE_EFFECT_DESPAWN_DELAY) continue

        const slideInfoAt = (context: PreviewFrameContext, t: number) => {
            const current = findSlideConnector(slide, t)
            if (!current) return
            if (
                !isActiveConnectorKind(current.kind) &&
                current.kind !== ConnectorKind.damage &&
                current.kind !== ConnectorKind.fakeDamage
            )
                return
            if (groupHidesNotesAt(current.segmentHead, t)) return

            const attachHead = effectiveAttachHead(current.head)
            const attachTail = effectiveAttachTail(current.tail)

            const frac =
                Math.abs(attachHead.targetTime - attachTail.targetTime) < 1e-6
                    ? 0.5
                    : unlerpClamped(attachHead.targetTime, attachTail.targetTime, t)
            const easedFrac = ease(current.ease, frac)

            const segmentFrac = remapClamped(
                current.head.targetTime,
                current.tail.targetTime,
                0,
                1,
                t,
            )

            const mask = interpolateVisualMasks(
                basicVisualMaskAt(attachHead, t),
                basicVisualMaskAt(attachTail, t),
                easedFrac,
            )
            const extents = maskedNoteExtents(
                lerp(basicVisualLaneAt(attachHead, t), basicVisualLaneAt(attachTail, t), easedFrac),
                lerp(attachHead.size, attachTail.size, easedFrac),
                mask,
            )
            return {
                connector: current,
                ...extents,
                yOffset: remapClamped(
                    current.head.targetTime,
                    current.tail.targetTime,
                    yOffsetAt(current.head, t),
                    yOffsetAt(current.tail, t),
                    t,
                ),
                noteAlpha: lerp(
                    visualNoteAlpha(current.head),
                    visualNoteAlpha(current.tail),
                    segmentFrac,
                ),
                affine: chart.isDynamicStages
                    ? stageTransformToAffineOrIdentity(
                          blendStageTransform(
                              basicStageTransformAt(context, attachHead, t),
                              basicStageTransformAt(context, attachTail, t),
                              easedFrac,
                          ),
                      )
                    : identityStageScreenTransform,
            }
        }

        if (now < end) {
            const info = slideInfoAt(context, now)
            if (info) {
                const isCritical = isActiveConnectorKind(info.connector.kind)
                    ? info.connector.kind === ConnectorKind.activeCritical ||
                      info.connector.kind === ConnectorKind.activeFakeCritical
                    : slide.activeHead.isCritical

                if (info.size > 0) {
                    drawSlideNoteHead(
                        context,
                        draw,
                        skin,
                        slide.activeHead.kind,
                        isCritical,
                        info.lane,
                        info.size,
                        start,
                        1 - info.yOffset,
                        info.affine,
                        info.noteAlpha,
                        undefined,
                        info.connector.style !== 'default'
                            ? info.connector.style
                            : slide.activeHead.style,
                    )
                }

                if (isActiveConnectorKind(info.connector.kind)) {
                    const place = (q: Quad) => transformQuadAffine(info.affine, q)
                    const billboard = (q: Quad) =>
                        transformBillboard(
                            info.affine,
                            q,
                            transformedVecAt(
                                context.layout,
                                info.lane,
                                approach(context.layout, 1 - info.yOffset),
                            ),
                        )

                    const connectorSkin = getStyledSkin(skin, info.connector.style)
                    const glowSprite = isCritical
                        ? connectorSkin.criticalActiveSlideConnectorSlotGlow
                        : connectorSkin.activeSlideConnectorSlotGlow
                    if (showEffects && glowSprite && info.size > 0) {
                        const glowHeight =
                            (3.25 + (Math.cos((now - start) * 8 * Math.PI) + 1) / 2) / 4.25
                        draw(
                            glowSprite,
                            billboard(
                                layoutSlotGlowEffect(
                                    context.layout,
                                    info.lane,
                                    info.size,
                                    glowHeight,
                                    info.yOffset,
                                ),
                            ),
                            getZ(
                                context.now,
                                LAYER_SLOT_GLOW_EFFECT,
                                start,
                                info.lane,
                                0,
                                true,
                                info.affine.elevation,
                            ),
                            remapClamped(start, start + 0.25, 0, 0.3, now),
                        )
                    }

                    const connectorParticle =
                        showEffects && particle
                            ? isCritical
                                ? getStyledParticle(particle, info.connector.style)
                                      .criticalSlideConnector
                                : getStyledParticle(particle, info.connector.style)
                                      .normalSlideConnector
                            : undefined
                    if (connectorParticle) {
                        const phase = ((((now - start) / CONNECTOR_LOOP_DURATION) % 1) + 1) % 1
                        if (connectorParticle.circular) {
                            drawParticleEffect(
                                draw,
                                connectorParticle.circular,
                                place(
                                    layoutCircularEffect(
                                        context.layout,
                                        info.lane,
                                        3.5,
                                        2.1,
                                        info.yOffset,
                                    ),
                                ),
                                phase,
                                true,
                                hashSeed(slideIndex, 201),
                                nextParticleZ(),
                            )
                        }
                        if (connectorParticle.linear) {
                            drawParticleEffect(
                                draw,
                                connectorParticle.linear,
                                billboard(
                                    layoutLinearEffect(context.layout, info.lane, 0, info.yOffset),
                                ),
                                phase,
                                true,
                                hashSeed(slideIndex, 202),
                                nextParticleZ(),
                            )
                        }
                    }
                }
            }
        }
        if (isActiveConnectorKind(slide.kind) && showEffects && particle) {
            const drawSpawned = (
                period: number,
                seedBase: number,
                spawn: (
                    context: PreviewFrameContext,
                    info: NonNullable<ReturnType<typeof slideInfoAt>>,
                    progress: number,
                    seed: number,
                ) => void,
            ) => {
                const firstIndex = Math.max(
                    0,
                    Math.ceil((now - start - LINEAR_EFFECT_DURATION) / period),
                )
                for (let k = firstIndex; ; k++) {
                    const spawnTime = start + k * period
                    if (spawnTime > now || spawnTime >= end) break

                    const progress = (now - spawnTime) / LINEAR_EFFECT_DURATION
                    if (progress >= 1) continue

                    withLayoutAt(spawnTime, (context) => {
                        const info = slideInfoAt(context, spawnTime)
                        if (!info) return
                        spawn(context, info, progress, hashSeed(slideIndex, seedBase + k))
                    })
                }
            }

            drawSpawned(CONNECTOR_TRAIL_SPAWN_PERIOD, 10000, (context, info, progress, seed) => {
                const isCritical =
                    info.connector.kind === ConnectorKind.activeCritical ||
                    info.connector.kind === ConnectorKind.activeFakeCritical
                const trail = isCritical
                    ? getStyledParticle(particle, info.connector.style).criticalSlideConnector
                          .trailLinear
                    : getStyledParticle(particle, info.connector.style).normalSlideConnector
                          .trailLinear
                if (!trail) return

                drawParticleEffect(
                    draw,
                    trail,
                    transformBillboard(
                        info.affine,
                        layoutLinearEffect(context.layout, info.lane, 0, info.yOffset),
                        transformedVecAt(
                            context.layout,
                            info.lane,
                            approach(context.layout, 1 - info.yOffset),
                        ),
                    ),
                    progress,
                    false,
                    seed,
                    nextParticleZ(),
                )
            })

            drawSpawned(CONNECTOR_SLOT_SPAWN_PERIOD, 20000, (context, info, progress, seed) => {
                const isCritical =
                    info.connector.kind === ConnectorKind.activeCritical ||
                    info.connector.kind === ConnectorKind.activeFakeCritical
                const slotLinear = isCritical
                    ? getStyledParticle(particle, info.connector.style).criticalSlideConnector
                          .slotLinear
                    : getStyledParticle(particle, info.connector.style).normalSlideConnector
                          .slotLinear
                if (!slotLinear) return

                for (const [i, slotLane] of iterSlotLanes(info.lane, info.size).entries()) {
                    drawParticleEffect(
                        draw,
                        slotLinear,
                        transformBillboard(
                            info.affine,
                            layoutLinearEffect(context.layout, slotLane, 0, info.yOffset),
                            transformedVecAt(
                                context.layout,
                                slotLane,
                                approach(context.layout, 1 - info.yOffset),
                            ),
                        ),
                        progress,
                        false,
                        hashSeed(seed, i),
                        nextParticleZ(),
                    )
                }
            })
        }
    }

    for (const { item: simLine } of queryGroupTimeIndex(
        frameIndex.simLines,
        now,
        latestTargets,
        fallbackLatestTarget,
    )) {
        const { left, right } = simLine
        if (now >= Math.min(left.targetTime, right.targetTime)) continue
        if (groupHidesNotes(left) || groupHidesNotes(right)) continue

        const leftMask = visualMaskAt(left, now)
        const rightMask = visualMaskAt(right, now)
        const leftExtents = maskedNoteExtents(visualLane(left), left.size, leftMask)
        const rightExtents = maskedNoteExtents(visualLane(right), right.size, rightMask)
        if (leftExtents.size <= 0 || rightExtents.size <= 0) continue

        drawSimLine(
            context,
            draw,
            skin,
            leftExtents.lane,
            visualProgress(left),
            left.targetTime,
            rightExtents.lane,
            visualProgress(right),
            right.targetTime,
            visualStageTransform(left),
            visualStageTransform(right),
            visualNoteAlpha(left),
            visualNoteAlpha(right),
        )
    }

    for (const { item: note, index: noteIndex } of showEffects
        ? queryTimeIndex(frameIndex.effects, now, now)
        : []) {
        const elapsed = now - note.targetTime
        if (elapsed < 0 || elapsed >= MAX_HIT_EFFECT_DURATION) continue
        if (note.isFake) continue
        if (
            note.kind === NoteKind.anchor ||
            note.kind === NoteKind.hideTick ||
            note.kind === NoteKind.damage
        )
            continue

        const target = note.targetTime
        const props = stagePropsAtTime(note.stageIndex, target)
        const pivotLane = props?.pivotLane ?? 0
        const halfOffset = props
            ? props.division.start.parity === 1 && props.division.start.size % 2 === 1
            : false
        const singleLine = props ? resolveJudgeLineStyle(props.judgeLineStyle) === 1 : false
        const laneParticles = props ? props.fullWidth <= 0 : true

        let lane
        let yOffset
        if (note.isAttached && note.attachHead && note.attachTail) {
            lane = lerp(
                basicVisualLaneAt(note.attachHead, target),
                basicVisualLaneAt(note.attachTail, target),
                attachEasedFrac(note),
            )
            yOffset = yOffsetAt(note, target)
        } else {
            lane = basicVisualLaneAt(note, target)
            yOffset = basicYOffsetAt(note, target)
        }
        const mask = visualMaskAt(note, target)
        const extents = maskedNoteExtents(lane, note.size, mask)
        lane = extents.lane
        const size = extents.size

        const particleSet =
            showEffects && particle
                ? getNoteParticleSet(
                      getStyledParticle(particle, note.style),
                      note.kind,
                      note.isCritical,
                      note.direction,
                  )
                : undefined
        const spriteSet = getNoteSpriteSet(
            skin,
            note.kind,
            note.isCritical,
            note.direction,
            note.style,
        )

        let affine = identityStageScreenTransform

        withLayoutAt(target, (context) => {
            affine = stageTransformToAffineOrIdentity(visualStageTransformAt(context, note, target))

            if (!particleSet) return

            const place = (q: Quad) => transformQuadAffine(affine, q)
            const billboard = (q: Quad) =>
                transformBillboard(
                    affine,
                    q,
                    transformedVecAt(context.layout, lane, approach(context.layout, 1 - yOffset)),
                )

            if (particleSet.linear && elapsed < LINEAR_EFFECT_DURATION) {
                drawParticleEffect(
                    draw,
                    particleSet.linear,
                    billboard(layoutLinearEffect(context.layout, lane, 0, yOffset)),
                    elapsed / LINEAR_EFFECT_DURATION,
                    false,
                    hashSeed(noteIndex, 1),
                    nextParticleZ(),
                )
            }
            if (particleSet.circular && elapsed < CIRCULAR_EFFECT_DURATION) {
                drawParticleEffect(
                    draw,
                    particleSet.circular,
                    place(layoutCircularEffect(context.layout, lane, 1.75, 1.05, yOffset)),
                    elapsed / CIRCULAR_EFFECT_DURATION,
                    false,
                    hashSeed(noteIndex, 2),
                    nextParticleZ(),
                )
            }
            if (particleSet.directional && elapsed < DIRECTIONAL_EFFECT_DURATION) {
                drawParticleEffect(
                    draw,
                    particleSet.directional,
                    billboard(
                        layoutRotatedLinearEffect(
                            context.layout,
                            lane,
                            directionShear(note.direction),
                            yOffset,
                        ),
                    ),
                    elapsed / DIRECTIONAL_EFFECT_DURATION,
                    false,
                    hashSeed(noteIndex, 3),
                    nextParticleZ(),
                )
            }
            if (particleSet.tick && elapsed < TICK_EFFECT_DURATION) {
                drawParticleEffect(
                    draw,
                    particleSet.tick,
                    billboard(layoutTickEffect(context.layout, lane, yOffset)),
                    elapsed / TICK_EFFECT_DURATION,
                    false,
                    hashSeed(noteIndex, 4),
                    nextParticleZ(),
                )
            }
            if (particleSet.slotLinear && elapsed < LINEAR_EFFECT_DURATION) {
                for (const [i, slotLane] of iterSlotLanes(
                    lane,
                    size,
                    pivotLane,
                    halfOffset,
                ).entries()) {
                    drawParticleEffect(
                        draw,
                        particleSet.slotLinear,
                        billboard(layoutLinearEffect(context.layout, slotLane, 0, yOffset)),
                        elapsed / LINEAR_EFFECT_DURATION,
                        false,
                        hashSeed(noteIndex, 10 + i),
                        nextParticleZ(),
                    )
                }
            }
            if (laneParticles) {
                const laneYOffset = note.isCritical && isFlickBodyKind(note.kind) ? yOffset : 0
                const extendDown = !(
                    note.isCritical &&
                    (isFlickBodyKind(note.kind) ||
                        note.kind === NoteKind.traceFlick ||
                        note.kind === NoteKind.headTraceFlick ||
                        note.kind === NoteKind.tailTraceFlick)
                )
                if (particleSet.lane && elapsed < LANE_EFFECT_DURATION) {
                    drawParticleEffect(
                        draw,
                        particleSet.lane,
                        place(
                            layoutParticleLane(
                                context.layout,
                                lane,
                                size,
                                laneYOffset,
                                extendDown,
                                true,
                            ),
                        ),
                        elapsed / LANE_EFFECT_DURATION,
                        false,
                        hashSeed(noteIndex, 5),
                        nextParticleZ(LANE_PARTICLE_LAYER),
                    )
                } else if (
                    !particleSet.lane &&
                    particleSet.laneBasic &&
                    elapsed < LANE_BASIC_EFFECT_DURATION
                ) {
                    drawParticleEffect(
                        draw,
                        particleSet.laneBasic,
                        place(
                            layoutParticleLane(
                                context.layout,
                                lane,
                                size,
                                laneYOffset,
                                extendDown,
                                false,
                            ),
                        ),
                        elapsed / LANE_BASIC_EFFECT_DURATION,
                        false,
                        hashSeed(noteIndex, 5),
                        nextParticleZ(LANE_PARTICLE_LAYER),
                    )
                }
            }
        })

        if (showEffects && spriteSet && size > 0) {
            if (spriteSet.slot && !singleLine && elapsed < SLOT_EFFECT_DURATION) {
                const a = 1 - elapsed / SLOT_EFFECT_DURATION
                for (const slotLane of iterSlotLanes(lane, size, pivotLane, halfOffset)) {
                    draw(
                        spriteSet.slot,
                        transformQuadAffine(
                            affine,
                            layoutSlotEffect(context.layout, slotLane, yOffset),
                        ),
                        getZ(
                            context.now,
                            LAYER_SLOT_EFFECT,
                            target,
                            slotLane,
                            0,
                            true,
                            affine.elevation,
                        ),
                        a,
                    )
                }
            }
            if (spriteSet.slotGlow && elapsed < SLOT_GLOW_EFFECT_DURATION) {
                const progress = elapsed / SLOT_GLOW_EFFECT_DURATION
                draw(
                    spriteSet.slotGlow,
                    transformBillboard(
                        affine,
                        layoutSlotGlowEffect(
                            context.layout,
                            lane,
                            size,
                            unlerpClamped(1, 0.8, progress),
                            yOffset,
                        ),
                        transformedVecAt(
                            context.layout,
                            lane,
                            approach(context.layout, 1 - yOffset),
                        ),
                    ),
                    getZ(
                        context.now,
                        LAYER_SLOT_GLOW_EFFECT,
                        target,
                        lane,
                        0,
                        true,
                        affine.elevation,
                    ),
                    1 - progress,
                )
            }
        }
    }

    renderer.flush()
    return layoutBackground(viewport, chart.isDynamicStages ? chart.cameras : [], camera)
}
