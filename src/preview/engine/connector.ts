import type { ZKey } from '../gl'
import type { PreviewSkin, Sprite } from '../skin'
import { circularConnectorFracs, connectorCurveDetail } from './connectorCurve'
import type { PreviewFrameContext } from './context'
import {
    LAYER_ACTIVE_SLIDE_CONNECTOR_BOTTOM,
    LAYER_ACTIVE_SLIDE_CONNECTOR_OVER,
    LAYER_ACTIVE_SLIDE_CONNECTOR_TOP,
    LAYER_ACTIVE_SLIDE_CONNECTOR_UNDER,
    LAYER_GUIDE_CONNECTOR_BOTTOM,
    LAYER_GUIDE_CONNECTOR_OVER,
    LAYER_GUIDE_CONNECTOR_TOP,
    LAYER_GUIDE_CONNECTOR_UNDER,
    getZ,
} from './layer'
import {
    approach,
    blendStageTransform,
    inverseApproachTilt,
    layoutSlideConnectorSegment,
    perspectiveVec,
    stageTransformIsIdentity,
    stageTransformToAffine,
    tiltWidthFactor,
    type PreviewLayout,
    type StageTransform,
} from './layout'
import { uncrossedMask, type VisualMask } from './mask'
import {
    EaseType,
    applyAffine,
    clamp,
    connectorInterpFrac,
    ease,
    easeOutCubic,
    easeOvershoot,
    isStepEase,
    lerp,
    pinnedEase,
    safeUnlerp,
    safeUnlerpClamped,
    transformQuadAffine,
    vec,
    type EaseTypeValue,
    type Quad,
} from './math'
import {
    ConnectorKind,
    isActiveConnectorKind,
    type ConnectorKindValue,
    type ConnectorLayerValue,
} from './model'

type Draw = (sprite: Sprite | undefined, quad: Quad, z: ZKey, a: number) => void

const SLIDE_ALPHA = 1
const GUIDE_ALPHA = 0.6

export const ConnectorVisualState = {
    waiting: 0,
    inactive: 1,
    active: 2,
} as const

export type ConnectorVisualStateValue =
    (typeof ConnectorVisualState)[keyof typeof ConnectorVisualState]

const getConnectorSprites = (skin: PreviewSkin, kind: ConnectorKindValue) => {
    if (kind === ConnectorKind.activeNormal || kind === ConnectorKind.activeFakeNormal) {
        return skin.activeSlideConnector
    }
    if (kind === ConnectorKind.activeCritical || kind === ConnectorKind.activeFakeCritical) {
        return skin.criticalActiveSlideConnector
    }
    if (kind === ConnectorKind.damage) return skin.damageSlideConnector
    if (kind === ConnectorKind.fakeDamage) {
        return { normal: skin.damageSlideConnector.normal, active: undefined }
    }
    return { normal: skin.guides[kind - ConnectorKind.guideNeutral], active: undefined }
}

const getConnectorLayer = (kind: ConnectorKindValue, layer: ConnectorLayerValue) => {
    if (isActiveConnectorKind(kind)) {
        switch (layer) {
            case 0:
                return LAYER_ACTIVE_SLIDE_CONNECTOR_TOP
            case 1:
                return LAYER_ACTIVE_SLIDE_CONNECTOR_BOTTOM
            case 2:
                return LAYER_ACTIVE_SLIDE_CONNECTOR_UNDER
            case 3:
                return LAYER_ACTIVE_SLIDE_CONNECTOR_OVER
        }
    }
    switch (layer) {
        case 0:
            return LAYER_GUIDE_CONNECTOR_TOP
        case 1:
            return LAYER_GUIDE_CONNECTOR_BOTTOM
        case 2:
            return LAYER_GUIDE_CONNECTOR_UNDER
        case 3:
            return LAYER_GUIDE_CONNECTOR_OVER
    }
}

const getConnectorZ = (
    context: PreviewFrameContext,
    kind: ConnectorKindValue,
    targetTime: number,
    lane: number,
    active: boolean,
    layer: ConnectorLayerValue,
    elevation = 0,
): ZKey => {
    const layerValue = getConnectorLayer(kind, layer)
    let etc
    if (kind === ConnectorKind.activeNormal || kind === ConnectorKind.activeFakeNormal) {
        etc = 3 - (active ? 1 : 0)
    } else if (kind === ConnectorKind.activeCritical || kind === ConnectorKind.activeFakeCritical) {
        etc = 1 - (active ? 1 : 0)
    } else if (kind === ConnectorKind.damage || kind === ConnectorKind.fakeDamage) {
        etc = 9 - (active ? 1 : 0)
    } else {
        etc = kind - ConnectorKind.guideNeutral
    }
    return getZ(context.now, layerValue, targetTime, lane, etc, true, elevation)
}

const getConnectorAlphaOption = (kind: ConnectorKindValue) =>
    isActiveConnectorKind(kind) ||
    kind === ConnectorKind.damage ||
    kind === ConnectorKind.fakeDamage
        ? SLIDE_ALPHA
        : kind === ConnectorKind.none
          ? 0
          : GUIDE_ALPHA

export type ConnectorEndpoint = {
    lane: number
    size: number
    visualProgress: number
    targetTime: number
    easeFrac: number
    transform?: StageTransform
    mask?: VisualMask
}

// sekai/lib/connector.py
const CONNECTOR_ZERO_SIZE_FALLBACK = 1e-3
const CONNECTOR_ALPHA_ERROR = 1 / 192
const CONNECTOR_ALPHA_SEGMENT_LENGTH = 2 * (32 / 1080)
const CONNECTOR_MIN_SEGMENT_LENGTH = 2 * (4 / 1080)
const CONNECTOR_CURVE_PIECES = 8
const CONNECTOR_CURVE_PIECE_THRESHOLD = 32
// The engine's default Slide Quality and Guide Quality.
const CONNECTOR_QUALITY = 1

type DrawQuad = (layout: Quad, baseA: number, elevation: number) => void

const stageTransformsEqual = (a?: StageTransform, b?: StageTransform) =>
    a === b ||
    (!!a &&
        !!b &&
        a.sr === b.sr &&
        a.px === b.px &&
        a.py === b.py &&
        a.tx === b.tx &&
        a.ty === b.ty &&
        a.projection.a00 === b.projection.a00 &&
        a.projection.a01 === b.projection.a01 &&
        a.projection.a02 === b.projection.a02 &&
        a.projection.a10 === b.projection.a10 &&
        a.projection.a11 === b.projection.a11 &&
        a.projection.a12 === b.projection.a12 &&
        a.projection.elevation === b.projection.elevation)

export const drawConnector = (
    context: PreviewFrameContext,
    draw: Draw,
    skin: PreviewSkin,
    kind: ConnectorKindValue,
    visualState: ConnectorVisualStateValue,
    easeType: EaseTypeValue,
    head: ConnectorEndpoint,
    tail: ConnectorEndpoint,
    segmentHeadTargetTime: number,
    segmentHeadLane: number,
    segmentHeadAlpha: number,
    segmentTailTargetTime: number,
    segmentTailAlpha: number,
    headNoteAlpha: number,
    tailNoteAlpha: number,
    layer: ConnectorLayerValue,
    fullScreen: boolean,
    bypassTailTargetTimeCheck = false,
    fullScreenStartTime = head.targetTime,
) => {
    const transformsEqual = stageTransformsEqual(head.transform, tail.transform)
    if (fullScreen) {
        if (
            fullScreenStartTime === tail.targetTime ||
            (context.leftLimit
                ? context.now <= Math.min(fullScreenStartTime, tail.targetTime)
                : context.now < Math.min(fullScreenStartTime, tail.targetTime)) ||
            context.now > Math.max(head.targetTime, tail.targetTime)
        )
            return
    } else if (
        (head.visualProgress < context.layout.progressStart &&
            tail.visualProgress < context.layout.progressStart) ||
        (head.visualProgress > context.layout.progressCutoff &&
            tail.visualProgress > context.layout.progressCutoff) ||
        (head.visualProgress === tail.visualProgress && transformsEqual)
    ) {
        return
    }

    if (kind === ConnectorKind.none) return

    if (headNoteAlpha <= 0 && tailNoteAlpha <= 0) return

    const sprites = getConnectorSprites(skin, kind)
    if (!sprites.normal) return

    if (kind === ConnectorKind.damage || kind === ConnectorKind.fakeDamage) {
        segmentHeadAlpha = 1
        segmentTailAlpha = 1
    }

    if (isActiveConnectorKind(kind)) {
        segmentHeadAlpha = 1
        segmentTailAlpha = 1
        if (
            (kind === ConnectorKind.activeFakeNormal ||
                kind === ConnectorKind.activeFakeCritical) &&
            visualState === ConnectorVisualState.inactive
        ) {
            visualState = ConnectorVisualState.active
        }
    } else if (kind !== ConnectorKind.damage) {
        visualState = ConnectorVisualState.waiting
    }

    const headAlpha =
        lerp(
            segmentHeadAlpha,
            segmentTailAlpha,
            safeUnlerpClamped(segmentHeadTargetTime, segmentTailTargetTime, head.targetTime),
        ) * headNoteAlpha
    const tailAlpha =
        lerp(
            segmentHeadAlpha,
            segmentTailAlpha,
            safeUnlerpClamped(segmentHeadTargetTime, segmentTailTargetTime, tail.targetTime),
        ) * tailNoteAlpha

    if (
        (context.leftLimit ? context.now > tail.targetTime : context.now >= tail.targetTime) &&
        !bypassTailTargetTimeCheck
    )
        return

    const drawQuad: DrawQuad = (layout, baseA, elevation) => {
        const zNormal = getConnectorZ(
            context,
            kind,
            segmentHeadTargetTime,
            segmentHeadLane,
            false,
            layer,
            elevation,
        )
        if (visualState === ConnectorVisualState.active && sprites.active) {
            const zActive = getConnectorZ(
                context,
                kind,
                segmentHeadTargetTime,
                segmentHeadLane,
                true,
                layer,
                elevation,
            )
            const aModifier = (Math.cos(2 * Math.PI * context.now) + 1) / 2
            draw(sprites.normal, layout, zNormal, baseA * easeOutCubic(aModifier))
            draw(sprites.active, layout, zActive, baseA * easeOutCubic(1 - aModifier))
        } else {
            draw(
                sprites.normal,
                layout,
                zNormal,
                baseA * (visualState === ConnectorVisualState.inactive ? 0.5 : 1),
            )
        }
    }

    if (fullScreen) {
        const judgeFrac = safeUnlerpClamped(head.targetTime, tail.targetTime, context.now)
        const judgeAlpha = lerp(headAlpha, tailAlpha, judgeFrac)
        const baseA = clamp(judgeAlpha * getConnectorAlphaOption(kind), 0, 1)
        if (baseA <= 0) return
        const w = context.layout.screenW / 2
        const h = context.layout.screenH / 2
        drawQuad(
            {
                bl: vec(-w, -h),
                tl: vec(-w, h),
                tr: vec(w, h),
                br: vec(w, -h),
            },
            baseA,
            head.transform && tail.transform
                ? lerp(
                      head.transform.projection.elevation,
                      tail.transform.projection.elevation,
                      judgeFrac,
                  )
                : 0,
        )
        return
    }

    // Split in-out steps at the jump.
    let pieceCount = 1
    let splitFrac = 1
    if (easeType === EaseType.inOutStep && head.easeFrac < 0.5 && 0.5 < tail.easeFrac) {
        pieceCount = 2
        splitFrac = (0.5 - head.easeFrac) / (tail.easeFrac - head.easeFrac)
    }
    for (let piece = 0; piece < pieceCount; piece++) {
        const firstPiece = piece === 0
        const lastPiece = piece === pieceCount - 1
        let pieceEaseType = easeType
        let constantInterpFrac = -1
        if (isStepEase(easeType)) {
            pieceEaseType = EaseType.none
            constantInterpFrac = connectorInterpFrac(
                easeType,
                head.easeFrac,
                tail.easeFrac,
                ((firstPiece ? head.easeFrac : 0.5) + (lastPiece ? tail.easeFrac : 0.5)) / 2,
                0,
            )
        }
        drawConnectorDefault(
            context.layout,
            drawQuad,
            kind,
            pieceEaseType,
            {
                ...head,
                visualProgress: firstPiece
                    ? head.visualProgress
                    : lerp(head.visualProgress, tail.visualProgress, splitFrac),
                targetTime: firstPiece
                    ? head.targetTime
                    : lerp(head.targetTime, tail.targetTime, splitFrac),
                easeFrac: firstPiece ? head.easeFrac : 0.5,
            },
            firstPiece ? headAlpha : lerp(headAlpha, tailAlpha, splitFrac),
            {
                ...tail,
                visualProgress: lastPiece
                    ? tail.visualProgress
                    : lerp(head.visualProgress, tail.visualProgress, splitFrac),
                targetTime: lastPiece
                    ? tail.targetTime
                    : lerp(head.targetTime, tail.targetTime, splitFrac),
                easeFrac: lastPiece ? tail.easeFrac : 0.5,
            },
            lastPiece ? tailAlpha : lerp(headAlpha, tailAlpha, splitFrac),
            transformsEqual,
            constantInterpFrac,
        )
    }
}

const ConnectorMaskStatus = { outside: 0, inside: 1, needsClipping: 2 } as const

const connectorMaskStatus = (
    startLane: number,
    startSize: number,
    endLane: number,
    endSize: number,
    left: number,
    right: number,
) => {
    // Let clipping handle zero-width endpoints so their fallback widths respect the mask.
    if (startSize <= 0 || endSize <= 0) return ConnectorMaskStatus.needsClipping
    const leftMin = Math.min(startLane - startSize, endLane - endSize)
    const rightMax = Math.max(startLane + startSize, endLane + endSize)
    if (rightMax <= left || leftMin >= right) return ConnectorMaskStatus.outside
    if (leftMin >= left && rightMax <= right) return ConnectorMaskStatus.inside
    return ConnectorMaskStatus.needsClipping
}

export const maskedConnectorExtentsByLimits = (
    lane: number,
    size: number,
    crossedLeft: number,
    crossedRight: number,
) => {
    const { left: maskLeft, right: maskRight } = uncrossedMask(crossedLeft, crossedRight)
    const maskedLeft = clamp(lane - size, maskLeft, maskRight)
    const maskedRight = clamp(lane + size, maskLeft, maskRight)
    const maskedSize = (maskedRight - maskedLeft) / 2
    const maskSize = Math.max(0, (maskRight - maskLeft) / 2)
    const renderSize = Math.min(
        maskedSize > 0 ? maskedSize : CONNECTOR_ZERO_SIZE_FALLBACK,
        maskSize,
    )
    const renderLane = clamp(
        (maskedLeft + maskedRight) / 2,
        maskLeft + renderSize,
        maskRight - renderSize,
    )
    return { lane: renderLane, size: renderSize, maskedSize }
}

const screenBottom = (layout: PreviewLayout) => -layout.screenH / 2
const screenTop = (layout: PreviewLayout) => layout.screenH / 2

const connectorIsOffScreen = (
    layout: PreviewLayout,
    startTravel: number,
    endTravel: number,
    headTransform: StageTransform | undefined,
    tailTransform: StageTransform | undefined,
) => {
    if (layout.rotate !== 0) return false
    let headYOffset = 0
    let tailYOffset = 0
    if (headTransform) {
        if (headTransform.sr !== 0 || headTransform.projection.elevation !== 0) return false
        headYOffset = headTransform.ty
    }
    if (tailTransform) {
        if (tailTransform.sr !== 0 || tailTransform.projection.elevation !== 0) return false
        tailYOffset = tailTransform.ty
    }
    if (headYOffset !== tailYOffset) return false
    const startY = startTravel * layout.hScale + layout.t + headYOffset
    const endY = endTravel * layout.hScale + layout.t + tailYOffset
    return (
        Math.max(startY, endY) < screenBottom(layout) || Math.min(startY, endY) > screenTop(layout)
    )
}

// Trims the vertical span when screen y depends only on connector progress.
const clipConnectorProgressToScreen = (
    layout: PreviewLayout,
    start: number,
    end: number,
    headTransform: StageTransform | undefined,
    transformsEqual: boolean,
): [number, number] => {
    let canClip = layout.rotate === 0 && transformsEqual
    let yOffset = layout.t
    const yScale = layout.hScale
    if (headTransform) {
        if (headTransform.sr !== 0 || headTransform.projection.elevation !== 0) canClip = false
        yOffset += headTransform.ty
    }
    if (canClip && Math.abs(yScale) >= 1e-8) {
        const startTravel = approach(layout, start)
        const endTravel = approach(layout, end)
        const screenStart = (screenBottom(layout) - 1e-4 - yOffset) / yScale
        const screenEnd = (screenTop(layout) + 1e-4 - yOffset) / yScale
        const travelMin = Math.min(screenStart, screenEnd)
        const travelMax = Math.max(screenStart, screenEnd)
        if (
            Math.max(startTravel, endTravel) <= travelMin ||
            Math.min(startTravel, endTravel) >= travelMax
        ) {
            end = start
        } else {
            const clippedStart = clamp(startTravel, travelMin, travelMax)
            const clippedEnd = clamp(endTravel, travelMin, travelMax)
            const progressMin = Math.min(start, end)
            const progressMax = Math.max(start, end)
            if (clippedStart !== startTravel)
                start = clamp(inverseApproachTilt(layout, clippedStart), progressMin, progressMax)
            if (clippedEnd !== endTravel)
                end = clamp(inverseApproachTilt(layout, clippedEnd), progressMin, progressMax)
        }
    }
    return [start, end]
}

const connectorSpanLength = (
    layout: PreviewLayout,
    startLane: number,
    startSize: number,
    startTravel: number,
    endLane: number,
    endSize: number,
    endTravel: number,
    headTransform: StageTransform | undefined,
    tailTransform: StageTransform | undefined,
    startInterpFrac: number,
    endInterpFrac: number,
    hasTransform: boolean,
    transformsEqual: boolean,
) => {
    if (!hasTransform || !headTransform || !tailTransform || transformsEqual) {
        const startWidth = tiltWidthFactor(layout, startTravel) * layout.wScale
        const endWidth = tiltWidthFactor(layout, endTravel) * layout.wScale
        const leftChange = (endLane - endSize) * endWidth - (startLane - startSize) * startWidth
        const rightChange = (endLane + endSize) * endWidth - (startLane + startSize) * startWidth
        const yChange = (endTravel - startTravel) * layout.hScale
        if (hasTransform && headTransform && tailTransform) {
            const p = headTransform.projection
            if (p.a00 !== 1 || p.a01 !== 0 || p.a10 !== 0 || p.a11 !== 1) {
                const cs = Math.cos(-layout.rotate)
                const sn = Math.sin(-layout.rotate)
                const leftX = leftChange * cs - yChange * sn
                const leftY = leftChange * sn + yChange * cs
                const rightX = rightChange * cs - yChange * sn
                const rightY = rightChange * sn + yChange * cs
                return Math.sqrt(
                    Math.max(
                        (p.a00 * leftX + p.a01 * leftY) ** 2 + (p.a10 * leftX + p.a11 * leftY) ** 2,
                        (p.a00 * rightX + p.a01 * rightY) ** 2 +
                            (p.a10 * rightX + p.a11 * rightY) ** 2,
                    ),
                )
            }
        }
        // Fixed rotations and translations do not change the edge lengths.
        return Math.sqrt(Math.max(leftChange ** 2, rightChange ** 2) + yChange ** 2)
    }

    const start = stageTransformToAffine(
        blendStageTransform(headTransform, tailTransform, startInterpFrac),
    )
    const end = stageTransformToAffine(
        blendStageTransform(headTransform, tailTransform, endInterpFrac),
    )
    const startLeft = applyAffine(
        start,
        perspectiveVec(layout, startLane - startSize, 1, startTravel),
    )
    const startRight = applyAffine(
        start,
        perspectiveVec(layout, startLane + startSize, 1, startTravel),
    )
    const endLeft = applyAffine(end, perspectiveVec(layout, endLane - endSize, 1, endTravel))
    const endRight = applyAffine(end, perspectiveVec(layout, endLane + endSize, 1, endTravel))
    return Math.max(
        Math.hypot(endLeft.x - startLeft.x, endLeft.y - startLeft.y),
        Math.hypot(endRight.x - startRight.x, endRight.y - startRight.y),
    )
}

const connectorSegmentCount = (
    geometryDetail: number,
    alphaRange: number,
    quality: number,
    pathLength: number,
) => {
    const geometryCount = Math.ceil(geometryDetail * quality)
    const alphaDetail = (alphaRange * quality) / (2 * CONNECTOR_ALPHA_ERROR)
    let alphaCount = Math.ceil(alphaDetail)
    const scaledLength = pathLength * quality
    const nominalCount = scaledLength / CONNECTOR_ALPHA_SEGMENT_LENGTH
    if (nominalCount < alphaCount) {
        const errorRatio = Math.max(1, alphaDetail / Math.max(1, nominalCount))
        alphaCount = Math.floor(Math.min(alphaCount, nominalCount * Math.sqrt(errorRatio)))
    }
    return Math.max(
        1,
        Math.floor(
            Math.min(
                Math.max(geometryCount, alphaCount),
                scaledLength / CONNECTOR_MIN_SEGMENT_LENGTH,
            ),
        ),
    )
}

type SegmentEnd = { lane: number; size: number; travel: number; interpFrac: number }

const drawConnectorDefault = (
    layout: PreviewLayout,
    drawQuad: DrawQuad,
    kind: ConnectorKindValue,
    easeType: EaseTypeValue,
    head: ConnectorEndpoint,
    headAlpha: number,
    tail: ConnectorEndpoint,
    tailAlpha: number,
    transformsEqual: boolean,
    constantInterpFrac: number,
) => {
    const headTransform = head.transform
    const tailTransform = tail.transform
    const headMask = head.mask
    const tailMask = tail.mask
    const [startVisualProgress, endVisualProgress] = clipConnectorProgressToScreen(
        layout,
        clamp(head.visualProgress, layout.progressStart, layout.progressCutoff),
        clamp(tail.visualProgress, layout.progressStart, layout.progressCutoff),
        headTransform,
        transformsEqual,
    )
    if (
        startVisualProgress === endVisualProgress &&
        (transformsEqual || head.visualProgress !== tail.visualProgress)
    )
        return
    const startFrac = safeUnlerpClamped(
        head.visualProgress,
        tail.visualProgress,
        startVisualProgress,
        0,
    )
    const endFrac = safeUnlerpClamped(
        head.visualProgress,
        tail.visualProgress,
        endVisualProgress,
        1,
    )
    const startEaseFrac = lerp(head.easeFrac, tail.easeFrac, startFrac)
    const endEaseFrac = lerp(head.easeFrac, tail.easeFrac, endFrac)
    const headEased = pinnedEase(easeType, head.easeFrac)
    const tailEased = pinnedEase(easeType, tail.easeFrac)
    const interpFracAt = (easeFrac: number, frac: number) =>
        constantInterpFrac < 0
            ? safeUnlerp(headEased, tailEased, ease(easeType, easeFrac), frac)
            : constantInterpFrac
    const startInterpFrac = interpFracAt(startEaseFrac, startFrac)
    const endInterpFrac = interpFracAt(endEaseFrac, endFrac)
    const startTravel = approach(layout, startVisualProgress)
    const endTravel = approach(layout, endVisualProgress)
    const startLane = lerp(head.lane, tail.lane, startInterpFrac)
    const endLane = lerp(head.lane, tail.lane, endInterpFrac)
    const startSize = lerp(head.size, tail.size, startInterpFrac)
    const endSize = lerp(head.size, tail.size, endInterpFrac)
    if (head.size <= 0 && tail.size <= 0) return
    const startAlpha = lerp(headAlpha, tailAlpha, startFrac)
    const endAlpha = lerp(headAlpha, tailAlpha, endFrac)
    const alphaOption = getConnectorAlphaOption(kind)
    if (alphaOption <= 0 || Math.max(startAlpha, endAlpha) <= 0) return
    if (connectorIsOffScreen(layout, startTravel, endTravel, headTransform, tailTransform)) return

    let maskEnabled = false
    let sameMaskStage = false
    if (headMask && tailMask) {
        maskEnabled = headMask.enabled && tailMask.enabled
        sameMaskStage =
            maskEnabled &&
            headMask.stageIndex !== undefined &&
            headMask.stageIndex >= 0 &&
            headMask.stageIndex === tailMask.stageIndex
    }
    if (sameMaskStage && easeOvershoot(easeType) === 0 && headMask) {
        // Edges stay between their endpoints when the easing does not overshoot.
        const status = connectorMaskStatus(
            startLane,
            startSize,
            endLane,
            endSize,
            headMask.left,
            headMask.right,
        )
        if (status === ConnectorMaskStatus.outside) return
        if (status === ConnectorMaskStatus.inside) maskEnabled = false
    }

    const verticalSpan = Math.abs((endTravel - startTravel) * layout.hScale)
    const hasTransform =
        !!headTransform &&
        !!tailTransform &&
        !(
            stageTransformIsIdentity(headTransform) &&
            (transformsEqual || stageTransformIsIdentity(tailTransform))
        )
    const constantTransform = hasTransform && transformsEqual
    const heterogeneousEndpoints =
        (hasTransform && !constantTransform) || (maskEnabled && !sameMaskStage)
    const leftChange = tail.lane - tail.size - (head.lane - head.size)
    const rightChange = tail.lane + tail.size - (head.lane + head.size)
    let geometryDetail = heterogeneousEndpoints
        ? 20
        : connectorCurveDetail(
              layout,
              easeType,
              headEased,
              tailEased,
              startEaseFrac,
              endEaseFrac,
              leftChange,
              rightChange,
              startTravel,
              endTravel,
          )
    const quality = CONNECTOR_QUALITY
    let circularFracs: number[] = []
    if (
        easeType >= EaseType.inCirc &&
        easeType <= EaseType.outInCirc &&
        constantInterpFrac < 0 &&
        !hasTransform &&
        !maskEnabled &&
        headAlpha === tailAlpha &&
        Math.abs(tailEased - headEased) >= 1e-6
    ) {
        circularFracs = circularConnectorFracs(
            layout,
            easeType,
            startEaseFrac,
            endEaseFrac,
            startVisualProgress,
            endVisualProgress,
            Math.max(Math.abs(leftChange), Math.abs(rightChange)) / Math.abs(tailEased - headEased),
            quality,
        )
        if (circularFracs.length > 0) geometryDetail = circularFracs.length / quality
    }

    if (
        geometryDetail * quality <= 1 &&
        headAlpha === tailAlpha &&
        (!hasTransform || constantTransform) &&
        !maskEnabled
    ) {
        if (startSize <= 0 && endSize <= 0) return
        const quad = layoutSlideConnectorSegment(
            layout,
            startLane,
            startSize > 0 ? startSize : CONNECTOR_ZERO_SIZE_FALLBACK,
            startTravel,
            endLane,
            endSize > 0 ? endSize : CONNECTOR_ZERO_SIZE_FALLBACK,
            endTravel,
        )
        const baseA = clamp(((startAlpha + endAlpha) / 2) * alphaOption, 0, 1)
        if (baseA <= 0) return
        if (hasTransform) {
            const transform = stageTransformToAffine(headTransform)
            drawQuad(transformQuadAffine(transform, quad), baseA, transform.elevation)
        } else {
            drawQuad(quad, baseA, 0)
        }
        return
    }

    let pathLength = Number.POSITIVE_INFINITY
    let alphaRange = Math.abs(endAlpha - startAlpha) * alphaOption
    if (Math.min(startAlpha, endAlpha) * alphaOption >= 1) alphaRange = 0
    const alphaDetail = alphaRange / (2 * CONNECTOR_ALPHA_ERROR)
    const minimumSpan = Math.max(
        Math.ceil(geometryDetail * quality) * CONNECTOR_MIN_SEGMENT_LENGTH,
        Math.ceil(alphaDetail * quality) * CONNECTOR_ALPHA_SEGMENT_LENGTH,
    )
    if (!heterogeneousEndpoints && (hasTransform || verticalSpan * quality < minimumSpan)) {
        pathLength = connectorSpanLength(
            layout,
            startLane,
            startSize,
            startTravel,
            endLane,
            endSize,
            endTravel,
            headTransform,
            tailTransform,
            startInterpFrac,
            endInterpFrac,
            hasTransform,
            transformsEqual,
        )
    }

    const transformAt = (interpFrac: number) =>
        hasTransform
            ? stageTransformToAffine(
                  constantTransform
                      ? headTransform
                      : blendStageTransform(headTransform, tailTransform, interpFrac),
              )
            : undefined
    const drawSegment = (start: SegmentEnd, end: SegmentEnd, baseA: number) => {
        if (baseA <= 0) return
        const startTransform = transformAt(start.interpFrac)
        const endTransform = transformAt(end.interpFrac)
        const edge = ({ lane, size, travel }: SegmentEnd, transform = startTransform) => {
            const left = perspectiveVec(layout, lane - size, 1, travel)
            const right = perspectiveVec(layout, lane + size, 1, travel)
            return transform
                ? { left: applyAffine(transform, left), right: applyAffine(transform, right) }
                : { left, right }
        }
        const a = edge(start)
        const b = edge(end, endTransform)
        // Keep the segment below both endpoint notes without accumulating depth offsets.
        const elevation =
            startTransform && endTransform
                ? Math.min(startTransform.elevation, endTransform.elevation)
                : 0
        drawQuad(
            start.travel >= end.travel
                ? { bl: a.left, br: a.right, tl: b.left, tr: b.right }
                : { bl: b.left, br: b.right, tl: a.left, tr: a.right },
            baseA,
            elevation,
        )
    }

    const drawMaskedSegment = (start: SegmentEnd, end: SegmentEnd, baseA: number) => {
        if (!headMask || !tailMask) return
        if (sameMaskStage) {
            // Split where either connector edge crosses a mask bound so each subsegment is clipped exactly.
            const splitFracs = [1]
            const startLeft = start.lane - start.size
            const endLeft = end.lane - end.size
            const startRight = start.lane + start.size
            const endRight = end.lane + end.size
            const leftMin = Math.min(startLeft, endLeft)
            const leftMax = Math.max(startLeft, endLeft)
            const rightMin = Math.min(startRight, endRight)
            const rightMax = Math.max(startRight, endRight)
            if (leftMin < headMask.left && headMask.left < leftMax)
                splitFracs.push((headMask.left - startLeft) / (endLeft - startLeft))
            if (leftMin < headMask.right && headMask.right < leftMax)
                splitFracs.push((headMask.right - startLeft) / (endLeft - startLeft))
            if (rightMin < headMask.left && headMask.left < rightMax)
                splitFracs.push((headMask.left - startRight) / (endRight - startRight))
            if (rightMin < headMask.right && headMask.right < rightMax)
                splitFracs.push((headMask.right - startRight) / (endRight - startRight))
            splitFracs.sort((a, b) => a - b)

            let previous = maskedConnectorExtentsByLimits(
                start.lane,
                start.size,
                headMask.left,
                headMask.right,
            )
            let previousTravel = start.travel
            let previousInterpFrac = start.interpFrac
            let previousFrac = 0
            for (const frac of splitFracs) {
                if (frac <= previousFrac) continue
                const next = maskedConnectorExtentsByLimits(
                    lerp(start.lane, end.lane, frac),
                    lerp(start.size, end.size, frac),
                    headMask.left,
                    headMask.right,
                )
                const nextTravel = lerp(start.travel, end.travel, frac)
                const nextInterpFrac = lerp(start.interpFrac, end.interpFrac, frac)
                if (previous.maskedSize > 0 || next.maskedSize > 0) {
                    drawSegment(
                        {
                            lane: previous.lane,
                            size: previous.size,
                            travel: previousTravel,
                            interpFrac: previousInterpFrac,
                        },
                        {
                            lane: next.lane,
                            size: next.size,
                            travel: nextTravel,
                            interpFrac: nextInterpFrac,
                        },
                        baseA,
                    )
                }
                previousFrac = frac
                previous = next
                previousTravel = nextTravel
                previousInterpFrac = nextInterpFrac
            }
        } else {
            const last = maskedConnectorExtentsByLimits(
                start.lane,
                start.size,
                lerp(headMask.left, tailMask.left, start.interpFrac),
                lerp(headMask.right, tailMask.right, start.interpFrac),
            )
            const next = maskedConnectorExtentsByLimits(
                end.lane,
                end.size,
                lerp(headMask.left, tailMask.left, end.interpFrac),
                lerp(headMask.right, tailMask.right, end.interpFrac),
            )
            if (last.maskedSize > 0 || next.maskedSize > 0) {
                drawSegment(
                    { ...start, lane: last.lane, size: last.size },
                    { ...end, lane: next.lane, size: next.size },
                    baseA,
                )
            }
        }
    }

    let segmentCount = connectorSegmentCount(geometryDetail, alphaRange, quality, pathLength)
    if (circularFracs.length > 0) segmentCount = circularFracs.length
    // Use fewer segments where the curve bends less.
    let pieceCounts: number[] = []
    const geometryCount = Math.ceil(geometryDetail * quality)
    if (
        !heterogeneousEndpoints &&
        circularFracs.length === 0 &&
        geometryCount > CONNECTOR_CURVE_PIECE_THRESHOLD &&
        geometryCount >= segmentCount
    ) {
        const alphaCount = Math.ceil(
            connectorSegmentCount(0, alphaRange, quality, pathLength) / CONNECTOR_CURVE_PIECES,
        )
        let pieceStartTravel = startTravel
        let total = 0
        for (let piece = 0; piece < CONNECTOR_CURVE_PIECES; piece++) {
            const pieceEndTravel = approach(
                layout,
                lerp(startVisualProgress, endVisualProgress, (piece + 1) / CONNECTOR_CURVE_PIECES),
            )
            const detail = connectorCurveDetail(
                layout,
                easeType,
                headEased,
                tailEased,
                lerp(startEaseFrac, endEaseFrac, piece / CONNECTOR_CURVE_PIECES),
                lerp(startEaseFrac, endEaseFrac, (piece + 1) / CONNECTOR_CURVE_PIECES),
                leftChange,
                rightChange,
                pieceStartTravel,
                pieceEndTravel,
            )
            const count = Math.max(1, Math.ceil(detail * quality), alphaCount)
            pieceCounts.push(count)
            total += count
            pieceStartTravel = pieceEndTravel
        }
        if (total < segmentCount) {
            segmentCount = total
        } else {
            pieceCounts = []
        }
    }
    if (pieceCounts.length === 0) pieceCounts = [segmentCount]

    let last: SegmentEnd = {
        lane: startLane,
        size: startSize,
        travel: startTravel,
        interpFrac: startInterpFrac,
    }
    let lastAlpha = startAlpha
    const pieceSize = 1 / pieceCounts.length
    for (const [piece, pieceCount] of pieceCounts.entries()) {
        const pieceStart = piece * pieceSize
        const segmentSize = pieceSize / pieceCount
        for (let pieceSegment = 1; pieceSegment <= pieceCount; pieceSegment++) {
            const segmentFrac =
                circularFracs.length > 0
                    ? // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                      circularFracs[pieceSegment - 1]!
                    : pieceStart + pieceSegment * segmentSize
            const nextFrac = lerp(startFrac, endFrac, segmentFrac)
            const nextInterpFrac = interpFracAt(
                lerp(startEaseFrac, endEaseFrac, segmentFrac),
                nextFrac,
            )
            const next: SegmentEnd = {
                lane: lerp(head.lane, tail.lane, nextInterpFrac),
                size: lerp(head.size, tail.size, nextInterpFrac),
                travel: approach(layout, lerp(startVisualProgress, endVisualProgress, segmentFrac)),
                interpFrac: nextInterpFrac,
            }
            const nextAlpha = lerp(headAlpha, tailAlpha, nextFrac)
            const baseA = clamp(((lastAlpha + nextAlpha) / 2) * alphaOption, 0, 1)

            let segmentMaskEnabled = maskEnabled
            let segmentVisible = baseA > 0
            if (segmentVisible && maskEnabled && sameMaskStage && headMask) {
                const status = connectorMaskStatus(
                    last.lane,
                    last.size,
                    next.lane,
                    next.size,
                    headMask.left,
                    headMask.right,
                )
                segmentVisible = status !== ConnectorMaskStatus.outside
                segmentMaskEnabled = status === ConnectorMaskStatus.needsClipping
            }
            if (segmentVisible) {
                if (segmentMaskEnabled) {
                    drawMaskedSegment(last, next, baseA)
                } else if (last.size > 0 || next.size > 0) {
                    // Give zero-width endpoints a small drawable width.
                    drawSegment(
                        { ...last, size: last.size > 0 ? last.size : CONNECTOR_ZERO_SIZE_FALLBACK },
                        { ...next, size: next.size > 0 ? next.size : CONNECTOR_ZERO_SIZE_FALLBACK },
                        baseA,
                    )
                }
            }
            last = next
            lastAlpha = nextAlpha
        }
    }
}
