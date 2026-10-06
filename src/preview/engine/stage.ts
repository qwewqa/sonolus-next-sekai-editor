import type { ZKey } from '../gl'
import type { JudgmentSpriteSet, PreviewSkin, Sprite } from '../skin'
import type { PreviewFrameContext } from './context'
import { LAYER_STAGE, getZ, getZAlt } from './layer'
import {
    approach,
    computeStageTransform,
    currentLayoutTransform,
    identityStageScreenTransform,
    identityStageTransform,
    layoutSekaiStage,
    layoutStageLaneByEdges,
    perspectiveRect,
    stageTransformToAffine,
    tiltDepth,
    tiltWidenedEdge,
    tiltWidthFactor,
    transformedVecAt,
    type StageScreenTransform,
    type StageTransform,
} from './layout'
import {
    clamp,
    eventProgress,
    lerp,
    lerpVec,
    rotateVec,
    transformQuadAffine,
    vec,
    type EaseTypeValue,
    type LimitOptions,
    type Quad,
    type Vec,
} from './math'
import type { PreviewStage } from './model'

export type Transition<T> = {
    start: T
    end: T
    progress: number
}

export type StageProps = {
    lane: number
    width: number
    pivotLane: number
    division: Transition<{ size: number; parity: number }>
    judgeLineColor: Transition<number>
    judgeLineStyle: Transition<number>
    leftBorderStyle: Transition<number>
    rightBorderStyle: Transition<number>
    order: number
    noteAlpha: number
    maskNotes: boolean
    laneAlpha: number
    judgeLineAlpha: number
    yOffset: number
    fullWidth: number
    divisionLineAlpha: number
    rotate: number
    xLaneTranslate: number
    yLaneTranslate: number
    centerWeight: number
    elevation: number
}

const FULL_WIDTH_HALF_EXTENT = 48
const JUDGE_LINE_BORDER_FACTOR = 5

type Draw = (sprite: Sprite | undefined, quad: Quad, z: ZKey, a: number) => void

const snapDividerEdgeToScreenPixels = (
    context: PreviewFrameContext,
    a: Vec,
    b: Vec,
): [Vec, Vec] => {
    const dx = b.x - a.x
    const dy = b.y - a.y
    const width = Math.hypot(dx, dy)
    const pixelSize = context.layout.screenPixelSize
    if (width <= 0 || pixelSize <= 0) return [a, b]

    const snappedWidth = Math.max(1, Math.round(width / pixelSize)) * pixelSize
    const halfScale = snappedWidth / width / 2
    const mx = (a.x + b.x) / 2
    const my = (a.y + b.y) / 2

    return [
        vec(mx - dx * halfScale, my - dy * halfScale),
        vec(mx + dx * halfScale, my + dy * halfScale),
    ]
}

const snapDividerThicknessToScreenPixels = (context: PreviewFrameContext, quad: Quad): Quad => {
    const [bl, br] = snapDividerEdgeToScreenPixels(context, quad.bl, quad.br)
    const [tl, tr] = snapDividerEdgeToScreenPixels(context, quad.tl, quad.tr)
    return { bl, tl, tr, br }
}

// The last event before t, or at t for the right limit.
const findEvent = (events: { time: number }[], t: number, rightLimit: boolean) => {
    let lo = 0
    let hi = events.length - 1
    let result = -1
    while (lo <= hi) {
        const mid = (lo + hi) >> 1
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const time = events[mid]!.time
        if (rightLimit ? time <= t : time < t) {
            result = mid
            lo = mid + 1
        } else {
            hi = mid - 1
        }
    }
    return result
}

const queryEvents = <T extends { time: number; ease: EaseTypeValue }>(
    events: T[],
    t: number,
    rightLimit: boolean,
): [T | undefined, T | undefined, number] => {
    const index = findEvent(events, t, rightLimit)
    const a = events[index]
    const b = events[index + 1]

    if (!a) return [undefined, b, 0]
    if (!b || b.time <= a.time) return [a, undefined, 0]

    return [a, b, eventProgress(a.ease, t, a.time, b.time, rightLimit)]
}

// Note-time values use the left limit; Play and Watch draw frames at the right limit.
export const getStageProps = (
    stage: PreviewStage,
    t: number,
    { rightLimit = false }: LimitOptions = {},
): StageProps => {
    const props: StageProps = {
        lane: 0,
        width: 0,
        pivotLane: 0,
        division: { start: { size: 0, parity: 0 }, end: { size: 0, parity: 0 }, progress: 0 },
        judgeLineColor: { start: 0, end: 0, progress: 0 },
        judgeLineStyle: { start: 0, end: 0, progress: 0 },
        leftBorderStyle: { start: 0, end: 0, progress: 0 },
        rightBorderStyle: { start: 0, end: 0, progress: 0 },
        order: stage.order,
        noteAlpha: 1,
        maskNotes: false,
        laneAlpha: 0,
        judgeLineAlpha: 0,
        yOffset: 0,
        fullWidth: 0,
        divisionLineAlpha: 0,
        rotate: 0,
        xLaneTranslate: 0,
        yLaneTranslate: 0,
        centerWeight: 0,
        elevation: 0,
    }

    const [maskA, maskB, maskProgress] = queryEvents(stage.masks, t, rightLimit)
    if (maskA) {
        props.lane = maskA.lane
        props.width = maskA.size
        props.maskNotes = maskA.maskNotes
        if (maskB) {
            const p = maskProgress
            props.lane = lerp(maskA.lane, maskB.lane, p)
            props.width = Math.max(0, lerp(maskA.size, maskB.size, p))
        }
    } else if (maskB) {
        props.lane = maskB.lane
        props.width = maskB.size
        props.maskNotes = maskB.maskNotes
    }

    const [pivotA, pivotB, pivotProgress] = queryEvents(stage.pivots, t, rightLimit)
    if (pivotA) {
        props.pivotLane = pivotA.lane
        props.division.start = {
            size: Math.trunc(pivotA.divisionSize),
            parity: pivotA.divisionParity,
        }
        props.division.end = props.division.start
        props.yOffset = pivotA.yOffset
        if (pivotB) {
            const p = pivotProgress
            props.pivotLane = lerp(pivotA.lane, pivotB.lane, p)
            props.division.end = {
                size: Math.trunc(pivotB.divisionSize),
                parity: pivotB.divisionParity,
            }
            props.division.progress = p
            props.yOffset = lerp(pivotA.yOffset, pivotB.yOffset, p)
        }
    } else if (pivotB) {
        props.pivotLane = pivotB.lane
        props.division.start = {
            size: Math.trunc(pivotB.divisionSize),
            parity: pivotB.divisionParity,
        }
        props.division.end = props.division.start
        props.yOffset = pivotB.yOffset
    }

    const [styleA, styleB, styleProgress] = queryEvents(stage.styles, t, rightLimit)
    if (styleA) {
        props.judgeLineColor = {
            start: styleA.judgeLineColor,
            end: styleA.judgeLineColor,
            progress: 0,
        }
        props.judgeLineStyle = {
            start: styleA.judgeLineStyle,
            end: styleA.judgeLineStyle,
            progress: 0,
        }
        props.leftBorderStyle = {
            start: styleA.leftBorderStyle,
            end: styleA.leftBorderStyle,
            progress: 0,
        }
        props.rightBorderStyle = {
            start: styleA.rightBorderStyle,
            end: styleA.rightBorderStyle,
            progress: 0,
        }
        props.noteAlpha = styleA.noteAlpha
        props.laneAlpha = styleA.laneAlpha
        props.judgeLineAlpha = styleA.judgeLineAlpha
        props.fullWidth = styleA.fullWidth
        props.divisionLineAlpha = styleA.divisionLineAlpha
        if (styleB) {
            const p = styleProgress
            props.judgeLineColor.end = styleB.judgeLineColor
            props.judgeLineColor.progress = p
            props.judgeLineStyle.end = styleB.judgeLineStyle
            props.judgeLineStyle.progress = p
            props.leftBorderStyle.end = styleB.leftBorderStyle
            props.leftBorderStyle.progress = p
            props.rightBorderStyle.end = styleB.rightBorderStyle
            props.rightBorderStyle.progress = p
            props.noteAlpha = clamp(lerp(styleA.noteAlpha, styleB.noteAlpha, p), 0, 1)
            props.laneAlpha = clamp(lerp(styleA.laneAlpha, styleB.laneAlpha, p), 0, 1)
            props.judgeLineAlpha = clamp(
                lerp(styleA.judgeLineAlpha, styleB.judgeLineAlpha, p),
                0,
                1,
            )
            props.fullWidth = clamp(lerp(styleA.fullWidth, styleB.fullWidth, p), 0, 1)
            props.divisionLineAlpha = clamp(
                lerp(styleA.divisionLineAlpha, styleB.divisionLineAlpha, p),
                0,
                1,
            )
        }
    } else if (styleB) {
        props.judgeLineColor = {
            start: styleB.judgeLineColor,
            end: styleB.judgeLineColor,
            progress: 0,
        }
        props.judgeLineStyle = {
            start: styleB.judgeLineStyle,
            end: styleB.judgeLineStyle,
            progress: 0,
        }
        props.leftBorderStyle = {
            start: styleB.leftBorderStyle,
            end: styleB.leftBorderStyle,
            progress: 0,
        }
        props.rightBorderStyle = {
            start: styleB.rightBorderStyle,
            end: styleB.rightBorderStyle,
            progress: 0,
        }
        props.noteAlpha = styleB.noteAlpha
        props.laneAlpha = styleB.laneAlpha
        props.judgeLineAlpha = styleB.judgeLineAlpha
        props.fullWidth = styleB.fullWidth
        props.divisionLineAlpha = styleB.divisionLineAlpha
    }

    const [transformA, transformB, transformProgress] = queryEvents(stage.transforms, t, rightLimit)
    if (transformA) {
        props.rotate = transformA.rotate
        props.xLaneTranslate = transformA.xLaneTranslate
        props.yLaneTranslate = transformA.yLaneTranslate
        props.centerWeight = transformA.centerWeight
        props.elevation = transformA.elevation
        if (transformB) {
            const p = transformProgress
            props.rotate = lerp(transformA.rotate, transformB.rotate, p)
            props.xLaneTranslate = lerp(transformA.xLaneTranslate, transformB.xLaneTranslate, p)
            props.yLaneTranslate = lerp(transformA.yLaneTranslate, transformB.yLaneTranslate, p)
            props.centerWeight = lerp(transformA.centerWeight, transformB.centerWeight, p)
            props.elevation = lerp(transformA.elevation, transformB.elevation, p)
        }
    } else if (transformB) {
        props.rotate = transformB.rotate
        props.xLaneTranslate = transformB.xLaneTranslate
        props.yLaneTranslate = transformB.yLaneTranslate
        props.centerWeight = transformB.centerWeight
        props.elevation = transformB.elevation
    }

    return props
}

export const stagePropsHasTransform = (props: StageProps) =>
    props.rotate !== 0 ||
    props.xLaneTranslate !== 0 ||
    props.yLaneTranslate !== 0 ||
    props.centerWeight !== 0 ||
    props.elevation !== 0

export const stagePropsTransform = (
    context: PreviewFrameContext,
    props: StageProps,
    elevationOffset = 0,
): StageTransform =>
    stagePropsHasTransform(props) || elevationOffset !== 0
        ? computeStageTransform(
              context.layout,
              currentLayoutTransform(context.layout),
              props.rotate,
              props.xLaneTranslate,
              props.yLaneTranslate,
              props.lane,
              props.centerWeight,
              props.elevation + elevationOffset,
          )
        : identityStageTransform

const transitionWeight = (transition: Transition<number>, target: number) => {
    let weight = 0
    if (transition.start === target) weight += 1 - transition.progress
    if (transition.end === target) weight += transition.progress
    return Math.max(0, weight)
}

const borderStyleWidth = (style: number, normal: number, medium: number, light: number) => {
    switch (style) {
        case 0:
            return normal
        case 1:
            return light
        case 3:
            return medium
        default:
            return 0
    }
}

const borderWidth = (style: Transition<number>, normal: number, medium: number, light: number) =>
    Math.max(
        0,
        lerp(
            borderStyleWidth(style.start, normal, medium, light),
            borderStyleWidth(style.end, normal, medium, light),
            style.progress,
        ),
    )

const borderSpriteTransition = (style: Transition<number>): Transition<number> => {
    let start = style.start === 3 ? 0 : style.start
    let end = style.end === 3 ? 0 : style.end
    if (start === 2) start = end
    if (end === 2) end = start
    return { start, end, progress: start === end ? 0 : style.progress }
}

// Overshooting blends collapse an edge at its midpoint instead of flipping it.
const blendBorderLayout = (start: Quad, end: Quad, progress: number): Quad => {
    const result = {
        bl: lerpVec(start.bl, end.bl, progress),
        br: lerpVec(start.br, end.br, progress),
        tl: lerpVec(start.tl, end.tl, progress),
        tr: lerpVec(start.tr, end.tr, progress),
    }
    const flipped = (a: Vec, b: Vec, startA: Vec, startB: Vec, endA: Vec, endB: Vec) =>
        (b.x - a.x) * (startB.x - startA.x + endB.x - endA.x) +
            (b.y - a.y) * (startB.y - startA.y + endB.y - endA.y) <
        0
    if (flipped(result.bl, result.br, start.bl, start.br, end.bl, end.br)) {
        const mid = lerpVec(result.bl, result.br, 0.5)
        result.bl = mid
        result.br = mid
    }
    if (flipped(result.tl, result.tr, start.tl, start.tr, end.tl, end.tr)) {
        const mid = lerpVec(result.tl, result.tr, 0.5)
        result.tl = mid
        result.tr = mid
    }
    return result
}

const borderBlendAlpha = (alpha: number, progress: number) => {
    const remaining = 1 - clamp(alpha * Math.max(0, progress), 0, 1)
    return remaining > 0 ? clamp((alpha * Math.max(0, 1 - progress)) / remaining, 0, 1) : 0
}

const clampAlpha = (alpha: number) => clamp(alpha, 0, 1)

const isCollapsedBorder = (q: Quad) =>
    q.bl.x === q.br.x && q.bl.y === q.br.y && q.tl.x === q.tr.x && q.tl.y === q.tr.y

export const resolveJudgeLineStyle = (style: Transition<number>) =>
    style.progress < 0.5 ? style.start : style.end

export const drawStaticStage = (context: PreviewFrameContext, draw: Draw, skin: PreviewSkin) => {
    if (skin.sekaiStage) {
        draw(skin.sekaiStage, layoutSekaiStage(context.layout), getZ(context.now, LAYER_STAGE), 1)
        return
    }

    drawDynamicStage(context, draw, skin, {
        lane: 0,
        width: 6,
        pivotLane: 0,
        division: { start: { size: 2, parity: 0 }, end: { size: 2, parity: 0 }, progress: 0 },
        judgeLineColor: { start: 5, end: 5, progress: 0 },
        judgeLineStyle: { start: 0, end: 0, progress: 0 },
        leftBorderStyle: { start: 0, end: 0, progress: 0 },
        rightBorderStyle: { start: 0, end: 0, progress: 0 },
        order: 0,
        noteAlpha: 1,
        maskNotes: false,
        laneAlpha: 1,
        judgeLineAlpha: 1,
        yOffset: 0,
        fullWidth: 0,
        divisionLineAlpha: 1,
        rotate: 0,
        xLaneTranslate: 0,
        yLaneTranslate: 0,
        centerWeight: 0,
        elevation: 0,
    })
}

export const drawStageWithProps = (
    context: PreviewFrameContext,
    draw: Draw,
    skin: PreviewSkin,
    props: StageProps,
) => {
    const transform = stagePropsHasTransform(props)
        ? stageTransformToAffine(stagePropsTransform(context, props))
        : identityStageScreenTransform

    drawDynamicStage(context, draw, skin, props, transform)
}

export const drawDynamicStage = (
    context: PreviewFrameContext,
    draw: Draw,
    skin: PreviewSkin,
    props: StageProps,
    transform: StageScreenTransform = identityStageScreenTransform,
) => {
    const {
        lane,
        width,
        pivotLane,
        division,
        judgeLineColor,
        judgeLineStyle,
        leftBorderStyle: originalLeftBorderStyle,
        rightBorderStyle: originalRightBorderStyle,
        order,
        laneAlpha,
        judgeLineAlpha,
        yOffset,
    } = props

    const place = (q: Quad) => transformQuadAffine(transform, q)

    const spritesSame = judgeLineColor.start === judgeLineColor.end
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const spritesA = skin.judgments[judgeLineColor.start] ?? skin.judgments[0]!
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const spritesB = skin.judgments[judgeLineColor.end] ?? skin.judgments[0]!
    const pSprites = spritesSame ? 0 : judgeLineColor.progress
    const wSpritesStart = Math.max(0, 1 - pSprites)
    const wSpritesEnd = Math.max(0, pSprites)
    const wDivStart = Math.max(0, 1 - division.progress)
    const wDivEnd = Math.max(0, division.progress)

    const wDefault = transitionWeight(judgeLineStyle, 0)
    const wSingleLine = transitionWeight(judgeLineStyle, 1)
    const fw = clamp(props.fullWidth, 0, 1)

    if (!skin.laneBackground) {
        drawFallbackStage(context, draw, skin, props, transform)
        return
    }

    const travel = approach(context.layout, 1 - yOffset)
    const nh = context.layout.noteH
    const l = lane - width
    const r = lane + width
    const halfJl = lerp(width, FULL_WIDTH_HALF_EXTENT, fw)
    const lJl = lane - halfJl
    const rJl = lane + halfJl

    const z = (sub: number) => getZAlt(LAYER_STAGE, order * 17 + sub, transform.elevation)

    const f = JUDGE_LINE_BORDER_FACTOR

    const layoutLaneBorder = (style: number, edge: number, isLeft: boolean): Quad => {
        const borderW = borderStyleWidth(style, 0.08, 0.04, 0.025)
        const left = style === 1 ? edge - borderW / 2 : isLeft ? edge - borderW : edge
        const right = style === 1 ? edge + borderW / 2 : isLeft ? edge : edge + borderW
        const bottom = layoutStageLaneByEdges(context.layout, left, right)
        const top = layoutStageLaneByEdges(
            context.layout,
            tiltWidenedEdge(context.layout, left, edge + 8 * (left - edge)),
            tiltWidenedEdge(context.layout, right, edge + 8 * (right - edge)),
        )
        return { bl: bottom.bl, br: bottom.br, tl: top.tl, tr: top.tr }
    }

    const leftBorderLayout = blendBorderLayout(
        layoutLaneBorder(originalLeftBorderStyle.start, l, true),
        layoutLaneBorder(originalLeftBorderStyle.end, l, true),
        originalLeftBorderStyle.progress,
    )
    const rightBorderLayout = blendBorderLayout(
        layoutLaneBorder(originalRightBorderStyle.start, r, false),
        layoutLaneBorder(originalRightBorderStyle.end, r, false),
        originalRightBorderStyle.progress,
    )

    const drawBorder = (style: number, isLeft: boolean, q: Quad, zKey: ZKey, alpha: number) => {
        if (alpha <= 0 || isCollapsedBorder(q)) return
        switch (style) {
            case 0:
            case 3: {
                if (!isLeft) q = { bl: q.br, br: q.bl, tl: q.tr, tr: q.tl }
                draw(skin.stageBorder, place(q), zKey, clampAlpha(alpha))
                break
            }
            case 1: {
                draw(
                    skin.laneDivider,
                    snapDividerThicknessToScreenPixels(context, place(q)),
                    zKey,
                    clampAlpha(alpha),
                )
                break
            }
        }
    }

    const drawLeftBorder = (style: number, zKey: ZKey, alpha: number) => {
        drawBorder(style, true, leftBorderLayout, zKey, alpha)
    }
    const drawRightBorder = (style: number, zKey: ZKey, alpha: number) => {
        drawBorder(style, false, rightBorderLayout, zKey, alpha)
    }

    const drawDividers = (
        divisionSize: number,
        parity: number,
        pivot: number,
        zKey: ZKey,
        alpha: number,
    ) => {
        if (divisionSize <= 0) return

        const eps = 0.001
        const parityOffset = parity === 1 ? divisionSize / 2 : 0
        const shiftedPivot = pivot + parityOffset

        const kStart = Math.floor((l - shiftedPivot + eps) / divisionSize) + 1
        const kEnd = Math.ceil((r - shiftedPivot - eps) / divisionSize) - 1

        for (let k = kStart; k <= kEnd; k++) {
            const pos = shiftedPivot + k * divisionSize
            const layoutB = layoutStageLaneByEdges(context.layout, pos - 0.0125, pos + 0.0125)
            const layoutT = layoutStageLaneByEdges(
                context.layout,
                tiltWidenedEdge(context.layout, pos - 0.0125, pos - 0.1),
                tiltWidenedEdge(context.layout, pos + 0.0125, pos + 0.1),
            )
            draw(
                skin.laneDivider,
                snapDividerThicknessToScreenPixels(
                    context,
                    place({ bl: layoutB.bl, tl: layoutT.tl, tr: layoutT.tr, br: layoutB.br }),
                ),
                zKey,
                clampAlpha(alpha),
            )
        }
    }

    const thicknessScale = lerp(
        1,
        travel > 0 ? clamp(1 / travel, 1, 4) : 4,
        context.layout.stageTilt,
    )
    const judgmentDividerSize =
        0.014 * thicknessScale * tiltWidthFactor(context.layout, travel) * context.layout.wScale
    const judgmentDividerOffset = rotateVec(vec(judgmentDividerSize, 0), -context.layout.rotate)
    const dividerDepthB = tiltDepth(context.layout, 1 + nh - nh / f + 0.001, travel)
    const dividerDepthT = tiltDepth(context.layout, 1 - nh + nh / f - 0.001, travel)

    const layoutJudgmentDivider = (dividerLane: number): Quad => {
        const b = transformedVecAt(context.layout, dividerLane, dividerDepthB)
        const t = transformedVecAt(context.layout, dividerLane, dividerDepthT)
        return {
            bl: vec(b.x - judgmentDividerOffset.x, b.y - judgmentDividerOffset.y),
            tl: vec(t.x - judgmentDividerOffset.x, t.y - judgmentDividerOffset.y),
            tr: vec(t.x + judgmentDividerOffset.x, t.y + judgmentDividerOffset.y),
            br: vec(b.x + judgmentDividerOffset.x, b.y + judgmentDividerOffset.y),
        }
    }

    const drawJudgmentDividers = (
        sprites: JudgmentSpriteSet,
        halfOffset: boolean,
        pivot: number,
        zLo: ZKey,
        zHi: ZKey,
        alpha: number,
    ) => {
        const eps = 0.001
        const shiftedPivot = pivot + (halfOffset ? 0.5 : 0)

        const kStart = Math.floor(l - shiftedPivot + eps) + 1
        const kEnd = Math.ceil(r - shiftedPivot - eps) - 1

        for (let k = kStart; k <= kEnd; k++) {
            const pos = shiftedPivot + k
            const divLayout = snapDividerThicknessToScreenPixels(
                context,
                place(layoutJudgmentDivider(pos)),
            )
            const edgeWeight = width > 0 ? Math.abs(pos - lane) / width : 0
            draw(sprites.center, divLayout, zLo, clampAlpha(alpha))
            draw(sprites.edge, divLayout, zHi, clampAlpha(alpha * edgeWeight))
        }
    }

    const layoutJudgmentBorder = (style: number, edge: number, isLeft: boolean): Quad => {
        if (style === 1) return layoutJudgmentDivider(edge)
        const borderW = style === 2 ? 0 : Math.max(0, Math.min(1 / f / 2, width))
        return perspectiveRect(
            context.layout,
            isLeft ? edge : edge - borderW,
            isLeft ? edge + borderW : edge,
            1 - nh + nh / f,
            1 + nh - nh / f,
            travel,
        )
    }

    const leftJudgmentLayout = blendBorderLayout(
        layoutJudgmentBorder(originalLeftBorderStyle.start, l, true),
        layoutJudgmentBorder(originalLeftBorderStyle.end, l, true),
        originalLeftBorderStyle.progress,
    )
    const rightJudgmentLayout = blendBorderLayout(
        layoutJudgmentBorder(originalRightBorderStyle.start, r, false),
        layoutJudgmentBorder(originalRightBorderStyle.end, r, false),
        originalRightBorderStyle.progress,
    )
    const leftBorderStyle = borderSpriteTransition(originalLeftBorderStyle)
    const rightBorderStyle = borderSpriteTransition(originalRightBorderStyle)

    const drawJudgmentBorder = (
        sprites: JudgmentSpriteSet,
        style: number,
        isLeft: boolean,
        q: Quad,
        zKey: ZKey,
        alpha: number,
    ) => {
        if (alpha <= 0 || isCollapsedBorder(q)) return
        switch (style) {
            case 0:
            case 3: {
                if (!isLeft) q = { bl: q.br, br: q.bl, tl: q.tr, tr: q.tl }
                draw(sprites.edgeLeft, place(q), zKey, clampAlpha(alpha))
                break
            }
            case 1: {
                draw(
                    sprites.edge,
                    snapDividerThicknessToScreenPixels(context, place(q)),
                    zKey,
                    clampAlpha(alpha),
                )
                break
            }
        }
    }

    const drawLeftJudgmentBorder = (
        sprites: JudgmentSpriteSet,
        style: number,
        zKey: ZKey,
        alpha: number,
    ) => {
        drawJudgmentBorder(sprites, style, true, leftJudgmentLayout, zKey, alpha)
    }
    const drawRightJudgmentBorder = (
        sprites: JudgmentSpriteSet,
        style: number,
        zKey: ZKey,
        alpha: number,
    ) => {
        drawJudgmentBorder(sprites, style, false, rightJudgmentLayout, zKey, alpha)
    }

    const drawGradient = (sprites: JudgmentSpriteSet, zKey: ZKey, alpha: number) => {
        const bottomL = place(
            perspectiveRect(context.layout, lJl, lane, 1 + nh, 1 + nh - nh / f, travel),
        )
        const bottomR = place(
            perspectiveRect(context.layout, rJl, lane, 1 + nh, 1 + nh - nh / f, travel),
        )
        const topL = place(
            perspectiveRect(context.layout, lJl, lane, 1 - nh, 1 - nh + nh / f, travel),
        )
        const topR = place(
            perspectiveRect(context.layout, rJl, lane, 1 - nh, 1 - nh + nh / f, travel),
        )
        const gradA = clampAlpha(alpha * (1 - fw))
        const edgeA = clampAlpha(alpha * fw)
        if (gradA > 0) {
            draw(sprites.gradient, bottomL, zKey, gradA)
            draw(sprites.gradient, bottomR, zKey, gradA)
            draw(sprites.gradient, topL, zKey, gradA)
            draw(sprites.gradient, topR, zKey, gradA)
        }
        if (edgeA > 0) {
            draw(sprites.edge, bottomL, zKey, edgeA)
            draw(sprites.edge, bottomR, zKey, edgeA)
            draw(sprites.edge, topL, zKey, edgeA)
            draw(sprites.edge, topR, zKey, edgeA)
        }
    }

    const drawSingleLine = (sprites: JudgmentSpriteSet, zKey: ZKey, alpha: number) => {
        const halfThick = nh / f / 2
        const layout = place(
            perspectiveRect(context.layout, lJl, rJl, 1 - halfThick, 1 + halfThick, travel),
        )
        draw(sprites.singleLine, layout, zKey, clampAlpha(alpha))
    }

    const la = laneAlpha * (1 - fw)
    if (la > 0) {
        draw(
            skin.laneBackground,
            place(layoutStageLaneByEdges(context.layout, l, r)),
            z(0),
            clampAlpha(la),
        )

        const pLeft = leftBorderStyle.progress
        if (leftBorderStyle.start === leftBorderStyle.end) {
            drawLeftBorder(leftBorderStyle.start, z(3), la)
        } else {
            drawLeftBorder(leftBorderStyle.start, z(3), borderBlendAlpha(la, pLeft))
            drawLeftBorder(leftBorderStyle.end, z(4), la * Math.max(0, pLeft))
        }

        const pRight = rightBorderStyle.progress
        if (rightBorderStyle.start === rightBorderStyle.end) {
            drawRightBorder(rightBorderStyle.start, z(3), la)
        } else {
            drawRightBorder(rightBorderStyle.start, z(3), borderBlendAlpha(la, pRight))
            drawRightBorder(rightBorderStyle.end, z(4), la * Math.max(0, pRight))
        }

        const laDiv = la * props.divisionLineAlpha
        if (laDiv > 0) {
            if (
                division.start.size === division.end.size &&
                division.start.parity === division.end.parity
            ) {
                drawDividers(division.start.size, division.start.parity, pivotLane, z(3), laDiv)
            } else {
                if (wDivStart > 0) {
                    drawDividers(
                        division.start.size,
                        division.start.parity,
                        pivotLane,
                        z(3),
                        laDiv * wDivStart,
                    )
                }
                if (wDivEnd > 0) {
                    drawDividers(
                        division.end.size,
                        division.end.parity,
                        pivotLane,
                        z(4),
                        laDiv * wDivEnd,
                    )
                }
            }
        }
    }

    const ja = judgeLineAlpha
    const jaBar = ja * wDefault
    const jaDec = jaBar * (1 - fw)
    const jaSingle = ja * wSingleLine

    if (jaBar > 0) {
        const bgLayout = place(perspectiveRect(context.layout, lJl, rJl, 1 - nh, 1 + nh, travel))
        if (spritesSame) {
            draw(spritesA.background, bgLayout, z(1), clampAlpha(jaBar))
        } else {
            draw(spritesA.background, bgLayout, z(1), clampAlpha(jaBar * wSpritesStart))
            draw(spritesB.background, bgLayout, z(2), clampAlpha(jaBar * wSpritesEnd))
        }
    }

    const pLeft = leftBorderStyle.progress
    const pRight = rightBorderStyle.progress

    const startHasHalfOffset = division.start.parity === 1 && division.start.size % 2 === 1
    const endHasHalfOffset = division.end.parity === 1 && division.end.size % 2 === 1
    const judgmentDividersSame = startHasHalfOffset === endHasHalfOffset

    if (jaDec > 0) {
        if (judgmentDividersSame && spritesSame) {
            drawJudgmentDividers(spritesA, startHasHalfOffset, pivotLane, z(5), z(6), jaDec)
        } else if (judgmentDividersSame) {
            drawJudgmentDividers(
                spritesA,
                startHasHalfOffset,
                pivotLane,
                z(5),
                z(6),
                jaDec * wSpritesStart,
            )
            drawJudgmentDividers(
                spritesB,
                startHasHalfOffset,
                pivotLane,
                z(9),
                z(10),
                jaDec * wSpritesEnd,
            )
        } else if (spritesSame) {
            drawJudgmentDividers(
                spritesA,
                startHasHalfOffset,
                pivotLane,
                z(5),
                z(6),
                jaDec * wDivStart,
            )
            drawJudgmentDividers(spritesA, endHasHalfOffset, pivotLane, z(7), z(8), jaDec * wDivEnd)
        } else {
            const alphaAa = wSpritesStart * wDivStart
            const alphaAb = wSpritesStart * wDivEnd
            const alphaBa = wSpritesEnd * wDivStart
            const alphaBb = wSpritesEnd * wDivEnd
            if (alphaAa > 0)
                drawJudgmentDividers(
                    spritesA,
                    startHasHalfOffset,
                    pivotLane,
                    z(5),
                    z(6),
                    jaDec * alphaAa,
                )
            if (alphaAb > 0)
                drawJudgmentDividers(
                    spritesA,
                    endHasHalfOffset,
                    pivotLane,
                    z(7),
                    z(8),
                    jaDec * alphaAb,
                )
            if (alphaBa > 0)
                drawJudgmentDividers(
                    spritesB,
                    startHasHalfOffset,
                    pivotLane,
                    z(9),
                    z(10),
                    jaDec * alphaBa,
                )
            if (alphaBb > 0)
                drawJudgmentDividers(
                    spritesB,
                    endHasHalfOffset,
                    pivotLane,
                    z(11),
                    z(12),
                    jaDec * alphaBb,
                )
        }
    }

    if (jaBar > 0) {
        if (spritesSame) {
            drawGradient(spritesA, z(13), jaBar)
        } else {
            drawGradient(spritesA, z(13), jaBar * wSpritesStart)
            drawGradient(spritesB, z(14), jaBar * wSpritesEnd)
        }
    }

    if (jaDec > 0) {
        if (spritesSame && leftBorderStyle.start === leftBorderStyle.end) {
            drawLeftJudgmentBorder(spritesA, leftBorderStyle.start, z(5), jaDec)
        } else {
            const alphaAa = borderBlendAlpha(jaDec * wSpritesStart, pLeft)
            const alphaAb = jaDec * wSpritesStart * Math.max(0, pLeft)
            const alphaBa = borderBlendAlpha(jaDec * wSpritesEnd, pLeft)
            const alphaBb = jaDec * wSpritesEnd * Math.max(0, pLeft)
            if (alphaAa > 0) drawLeftJudgmentBorder(spritesA, leftBorderStyle.start, z(5), alphaAa)
            if (alphaAb > 0) drawLeftJudgmentBorder(spritesA, leftBorderStyle.end, z(7), alphaAb)
            if (alphaBa > 0) drawLeftJudgmentBorder(spritesB, leftBorderStyle.start, z(9), alphaBa)
            if (alphaBb > 0) drawLeftJudgmentBorder(spritesB, leftBorderStyle.end, z(11), alphaBb)
        }

        if (spritesSame && rightBorderStyle.start === rightBorderStyle.end) {
            drawRightJudgmentBorder(spritesA, rightBorderStyle.start, z(5), jaDec)
        } else {
            const alphaAa = borderBlendAlpha(jaDec * wSpritesStart, pRight)
            const alphaAb = jaDec * wSpritesStart * Math.max(0, pRight)
            const alphaBa = borderBlendAlpha(jaDec * wSpritesEnd, pRight)
            const alphaBb = jaDec * wSpritesEnd * Math.max(0, pRight)
            if (alphaAa > 0)
                drawRightJudgmentBorder(spritesA, rightBorderStyle.start, z(5), alphaAa)
            if (alphaAb > 0) drawRightJudgmentBorder(spritesA, rightBorderStyle.end, z(7), alphaAb)
            if (alphaBa > 0)
                drawRightJudgmentBorder(spritesB, rightBorderStyle.start, z(9), alphaBa)
            if (alphaBb > 0) drawRightJudgmentBorder(spritesB, rightBorderStyle.end, z(11), alphaBb)
        }
    }

    if (jaSingle > 0) {
        if (spritesSame) {
            drawSingleLine(spritesA, z(15), jaSingle)
        } else {
            drawSingleLine(spritesA, z(15), jaSingle * wSpritesStart)
            drawSingleLine(spritesB, z(16), jaSingle * wSpritesEnd)
        }
    }
}

const drawFallbackStage = (
    context: PreviewFrameContext,
    draw: Draw,
    skin: PreviewSkin,
    props: StageProps,
    transform: StageScreenTransform,
) => {
    const { lane, width, pivotLane, division, judgeLineStyle, order } = props

    const place = (q: Quad) => transformQuadAffine(transform, q)

    const wDefault = transitionWeight(judgeLineStyle, 0)
    const wSingleLine = transitionWeight(judgeLineStyle, 1)
    const travel = approach(context.layout, 1 - props.yOffset)
    const nh = context.layout.noteH
    const l = lane - width
    const r = lane + width
    const fw = clamp(props.fullWidth, 0, 1)
    const halfJl = lerp(width, FULL_WIDTH_HALF_EXTENT, fw)
    const lJl = lane - halfJl
    const rJl = lane + halfJl
    const zLo = getZAlt(LAYER_STAGE, order * 4, transform.elevation)
    const zMid = getZAlt(LAYER_STAGE, order * 4 + 1, transform.elevation)
    const zHi = getZAlt(LAYER_STAGE, order * 4 + 2, transform.elevation)
    const zSingle = getZAlt(LAYER_STAGE, order * 4 + 3, transform.elevation)
    const la = props.laneAlpha * (1 - fw)
    const ja = props.judgeLineAlpha
    const leftWidth = borderWidth(props.leftBorderStyle, 0.25, 0.125, 0.025)
    const rightWidth = borderWidth(props.rightBorderStyle, 0.25, 0.125, 0.025)

    if (la > 0) {
        if (leftWidth > 0) {
            const layoutB = layoutStageLaneByEdges(context.layout, l - leftWidth, l)
            const layoutT = layoutStageLaneByEdges(
                context.layout,
                tiltWidenedEdge(context.layout, l - leftWidth, l - 4 * leftWidth),
                l,
            )
            draw(
                skin.stageLeftBorder,
                place({ bl: layoutB.bl, tl: layoutT.tl, tr: layoutT.tr, br: layoutB.br }),
                zMid,
                clampAlpha(la),
            )
        }
        if (rightWidth > 0) {
            const layoutB = layoutStageLaneByEdges(context.layout, r, r + rightWidth)
            const layoutT = layoutStageLaneByEdges(
                context.layout,
                r,
                tiltWidenedEdge(context.layout, r + rightWidth, r + 4 * rightWidth),
            )
            draw(
                skin.stageRightBorder,
                place({ bl: layoutB.bl, tl: layoutT.tl, tr: layoutT.tr, br: layoutB.br }),
                zMid,
                clampAlpha(la),
            )
        }

        const eps = 0.001
        const divisionSize = division.end.size
        const parityOffset = division.end.parity === 1 ? divisionSize / 2 : 0
        const shiftedPivot = pivotLane + parityOffset
        let prev = l
        if (divisionSize > 0) {
            const kStart = Math.floor((l - shiftedPivot + eps) / divisionSize) + 1
            const kEnd = Math.ceil((r - shiftedPivot - eps) / divisionSize) - 1
            for (let k = kStart; k <= kEnd; k++) {
                const pos = shiftedPivot + k * divisionSize
                draw(
                    skin.lane,
                    place(layoutStageLaneByEdges(context.layout, prev, pos)),
                    zLo,
                    clampAlpha(la),
                )
                prev = pos
            }
        }
        draw(skin.lane, place(layoutStageLaneByEdges(context.layout, prev, r)), zLo, clampAlpha(la))
    }

    if (ja * wDefault > 0) {
        const layout = place(perspectiveRect(context.layout, lJl, rJl, 1 - nh, 1 + nh, travel))
        draw(skin.judgmentLine, layout, zHi, clampAlpha(ja * wDefault))
    }
    if (ja * wSingleLine > 0) {
        const halfThick = nh / JUDGE_LINE_BORDER_FACTOR / 2
        const layout = place(
            perspectiveRect(context.layout, lJl, rJl, 1 - halfThick, 1 + halfThick, travel),
        )
        draw(skin.judgmentLine, layout, zSingle, clampAlpha(ja * wSingleLine))
    }
}
