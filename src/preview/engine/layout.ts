import {
    applyAffine,
    clamp,
    eventProgress,
    identityAffineTransform,
    lerp,
    rotateVec,
    subVec,
    translateQuad,
    unlerp,
    vec,
    type AffineTransform,
    type EaseTypeValue,
    type Quad,
    type Vec,
} from './math'

export const LANE_T = 47 / 850
export const LANE_B = 1176 / 850

export const NOTE_H = 75 / 850 / 2
export const NOTE_EDGE_W = 0.25
export const NOTE_SLIM_EDGE_W = 0.125

export const TARGET_ASPECT_RATIO = 16 / 9

export const FIELD_T_FACTOR = 0.5 + 1.15875 * (47 / 1176)
export const FIELD_B_FACTOR = 0.5 - 1.15875 * (803 / 1176)
export const FIELD_W_FACTOR = (1.15875 * (1420 / 1176)) / TARGET_ASPECT_RATIO / 12

export const APPROACH_SCALE = 1.06 ** -45
export const DEFAULT_APPROACH_CUTOFF = 5
const APPROACH_TILT_LERP_MIN = 0.05
export const STAGE_WIDTH_MID = (APPROACH_SCALE + 1) / 2
const STAGE_TILT_VANISH_MIN = 0.2

export const FlickDirection = {
    upOmni: 0,
    upLeft: 1,
    upRight: 2,
    downOmni: 3,
    downLeft: 4,
    downRight: 5,
} as const

export type FlickDirectionValue = (typeof FlickDirection)[keyof typeof FlickDirection]

export type CameraChange = {
    time: number
    lane: number
    size: number
    zoom: number
    zoomTargetLane: number
    zoomTargetY: number
    zoomVerticalAlign: 0 | 1
    rotate: number
    stageTilt: number
    ease: EaseTypeValue
}

export type CameraInfo = {
    lane: number
    size: number
    zoom: number
    zoomTarget: Vec
    zoomAnchor: Vec
    rotate: number
    stageTilt: number
}

export type LayoutTransform = {
    t: number
    wScale: number
    hScale: number
    xTranslate: number
    rotate: number
    stageTilt: number
    sizeZoom: number
}

export type PreviewViewport = Readonly<{
    fieldW: number
    fieldH: number
    screenW: number
    screenH: number
    screenPixelSize: number
}>

export type PreviewLayout = Readonly<
    PreviewViewport &
        LayoutTransform & {
            noteH: number
            scaledNoteH: number
            progressStart: number
            progressCutoff: number
            widthOffset: number
            laneT: number
            laneB: number
            safeLaneT: number
            stageLaneT: number
            stageLaneB: number
        }
>

export const createViewport = (displayWidth: number, displayHeight: number): PreviewViewport => {
    const aspectRatio = displayWidth / displayHeight
    return {
        fieldW: 2 * Math.min(aspectRatio, TARGET_ASPECT_RATIO),
        fieldH: aspectRatio > TARGET_ASPECT_RATIO ? 2 : (2 * aspectRatio) / TARGET_ASPECT_RATIO,
        screenW: 2 * aspectRatio,
        screenH: 2,
        screenPixelSize: 2 / displayHeight,
    }
}

export const defaultCameraInfo = (): CameraInfo => ({
    lane: 0,
    size: 6,
    zoom: 1,
    zoomTarget: vec(0, 0),
    zoomAnchor: vec(0, 0),
    rotate: 0,
    stageTilt: 1,
})

const CAMERA_MIN_SIZE = 0.01
const CAMERA_MIN_ZOOM = 0.01

const toCameraInfo = (context: PreviewViewport, camera: CameraChange): CameraInfo => ({
    lane: camera.lane,
    size: Math.max(CAMERA_MIN_SIZE, camera.size),
    zoom: camera.zoom,
    zoomTarget: cameraZoomTargetAt(
        context,
        camera.lane,
        Math.max(CAMERA_MIN_SIZE, camera.size),
        camera.zoomTargetLane,
        camera.zoomTargetY,
        camera.stageTilt,
    ),
    zoomAnchor: cameraZoomAnchor(context, camera.zoomVerticalAlign),
    rotate: camera.rotate,
    stageTilt: camera.stageTilt,
})

// Left limit, as in Play and Watch.
export const getCameraInfo = (
    context: PreviewViewport,
    cameras: CameraChange[],
    t: number,
): CameraInfo => {
    if (!cameras.length) return defaultCameraInfo()

    let lo = 0
    let hi = cameras.length - 1
    let index = -1
    while (lo <= hi) {
        const mid = (lo + hi) >> 1
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        if (cameras[mid]!.time < t) {
            index = mid
            lo = mid + 1
        } else {
            hi = mid - 1
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    if (index === -1) return toCameraInfo(context, cameras[0]!)

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const a = cameras[index]!
    const b = cameras[index + 1]
    if (!b || b.time <= a.time) return toCameraInfo(context, a)

    const p = eventProgress(a.ease, t, a.time, b.time)
    const infoA = toCameraInfo(context, a)
    const infoB = toCameraInfo(context, b)

    return {
        lane: lerp(a.lane, b.lane, p),
        size: Math.max(CAMERA_MIN_SIZE, lerp(a.size, b.size, p)),
        zoom: Math.max(CAMERA_MIN_ZOOM, lerp(a.zoom, b.zoom, p)),
        zoomTarget: vec(
            lerp(infoA.zoomTarget.x, infoB.zoomTarget.x, p),
            lerp(infoA.zoomTarget.y, infoB.zoomTarget.y, p),
        ),
        zoomAnchor: vec(
            lerp(infoA.zoomAnchor.x, infoB.zoomAnchor.x, p),
            lerp(infoA.zoomAnchor.y, infoB.zoomAnchor.y, p),
        ),
        rotate: lerp(a.rotate, b.rotate, p),
        stageTilt: lerp(a.stageTilt, b.stageTilt, p),
    }
}

export const cameraZoomTargetAt = (
    context: PreviewViewport,
    lane: number,
    size: number,
    targetLane: number,
    targetY: number,
    tilt: number,
): Vec => {
    const sizeZoom = 6 / size
    const w = context.fieldW * FIELD_W_FACTOR * sizeZoom
    const tTop = context.fieldH * FIELD_T_FACTOR
    const b = context.fieldH * FIELD_B_FACTOR
    const travel = approachAtTilt(1 - targetY, tilt)
    const targetTotalLane = lane + targetLane
    return vec(
        targetTotalLane * widthFactorAtTilt(travel, tilt) * w - lane * w,
        travel * (b - tTop) + tTop,
    )
}

export const cameraZoomAnchor = (context: PreviewViewport, align: 0 | 1): Vec =>
    vec(0, align === 1 ? 0 : context.fieldH * FIELD_B_FACTOR)

export const createLayout = (
    viewport: PreviewViewport,
    camera: CameraInfo,
    dynamicStages: boolean,
): PreviewLayout => {
    const base = baseLayoutTransform(viewport, camera)
    const tilt = base.stageTilt
    const widthOffset = (1 - tilt) * STAGE_WIDTH_MID
    const vanishTilt = Math.max(tilt, STAGE_TILT_VANISH_MIN)
    const vanishExt = ((1 - vanishTilt) * STAGE_WIDTH_MID) / vanishTilt
    const baseNoteH = NOTE_H * (0.6 * base.sizeZoom + 0.4)
    const flatNoteH = (STAGE_WIDTH_MID * base.wScale) / (2 * Math.abs(base.hScale))
    const noteH = lerp(flatNoteH, baseNoteH, tilt)
    const zoomed = zoomedLayoutTransform(
        base,
        camera.zoom,
        camera.zoomTarget,
        camera.zoomAnchor,
        camera.rotate,
    )
    return {
        ...viewport,
        ...zoomed,
        noteH,
        scaledNoteH: noteH * zoomed.hScale,
        progressStart: inverseApproachTilt(zoomed, APPROACH_SCALE - vanishExt),
        progressCutoff: inverseApproachTilt(zoomed, DEFAULT_APPROACH_CUTOFF),
        widthOffset,
        laneT: LANE_T - vanishExt,
        laneB: LANE_B + vanishExt,
        safeLaneT: (1e-4 - widthOffset) / Math.max(tilt, 1e-6),
        stageLaneT: LANE_T - vanishExt * (dynamicStages ? 0.9 : 1),
        stageLaneB: LANE_B + vanishExt + (dynamicStages ? 3 : 0),
    }
}

export const baseLayoutTransform = (
    context: PreviewViewport,
    camera: CameraInfo,
): LayoutTransform => {
    const sizeZoom = 6 / camera.size
    const t = context.fieldH * FIELD_T_FACTOR
    const w = context.fieldW * FIELD_W_FACTOR * sizeZoom
    return {
        t,
        wScale: w,
        hScale: context.fieldH * FIELD_B_FACTOR - t,
        xTranslate: -camera.lane * w,
        rotate: 0,
        stageTilt: clamp(camera.stageTilt, 0, 1),
        sizeZoom,
    }
}

export const zoomedLayoutTransform = (
    transform: LayoutTransform,
    zoom: number,
    target: Vec,
    anchor: Vec,
    rotate: number,
): LayoutTransform => ({
    t: zoom * (transform.t - target.y) + anchor.y,
    wScale: zoom * transform.wScale,
    hScale: zoom * transform.hScale,
    xTranslate: zoom * (transform.xTranslate - target.x) + anchor.x,
    rotate,
    stageTilt: transform.stageTilt,
    sizeZoom: transform.sizeZoom,
})

export const layoutTransformAtCamera = (
    context: PreviewViewport,
    camera: CameraInfo,
): LayoutTransform =>
    zoomedLayoutTransform(
        baseLayoutTransform(context, camera),
        camera.zoom,
        camera.zoomTarget,
        camera.zoomAnchor,
        camera.rotate,
    )

export const currentLayoutTransform = (context: PreviewLayout): LayoutTransform => ({
    t: context.t,
    wScale: context.wScale,
    hScale: context.hScale,
    xTranslate: context.xTranslate,
    rotate: context.rotate,
    stageTilt: context.stageTilt,
    sizeZoom: context.sizeZoom,
})

const approachCurveBase = (x: number) => APPROACH_SCALE ** (1 - x)

const inverseApproachCurveBase = (approachValue: number) =>
    1 - Math.log(approachValue) / Math.log(APPROACH_SCALE)

const approachSliceWindow = (tilt: number, spawnDepth: number): [number, number] => {
    const wJudge = widthFactorAtTilt(1, tilt)
    const spawnFraction = (tilt * (1 - spawnDepth)) / wJudge
    const sliceSpawn = 1 - spawnFraction
    return [inverseApproachCurveBase(sliceSpawn), sliceSpawn]
}

const approachSlice = (progress: number, tilt: number, spawnDepth: number) => {
    const [start, sliceSpawn] = approachSliceWindow(tilt, spawnDepth)
    const travel = approachCurveBase(lerp(start, 1, progress))
    return lerp(spawnDepth, 1, unlerp(sliceSpawn, 1, travel))
}

const inverseApproachSlice = (travel: number, tilt: number, spawnDepth: number) => {
    const [start, sliceSpawn] = approachSliceWindow(tilt, spawnDepth)
    const raw = lerp(sliceSpawn, 1, unlerp(spawnDepth, 1, travel))
    return unlerp(start, 1, inverseApproachCurveBase(raw))
}

export const approachAtTilt = (progress: number, tilt: number): number => {
    if (tilt >= 1) return approachCurveBase(progress)

    const spawnDepth = APPROACH_SCALE
    if (tilt <= 0) return lerp(spawnDepth, 1, progress)

    if (tilt < APPROACH_TILT_LERP_MIN) {
        const linear = lerp(spawnDepth, 1, progress)
        const sliceAtFloor = approachSlice(progress, APPROACH_TILT_LERP_MIN, spawnDepth)
        return lerp(linear, sliceAtFloor, tilt / APPROACH_TILT_LERP_MIN)
    }

    return approachSlice(progress, tilt, spawnDepth)
}

export const approach = (context: PreviewLayout, progress: number) =>
    approachAtTilt(progress, context.stageTilt)

export const inverseApproachTilt = (
    context: Pick<LayoutTransform, 'stageTilt'>,
    approachValue: number,
): number => {
    const tilt = context.stageTilt
    if (tilt >= 1) return inverseApproachCurveBase(approachValue)

    const spawnDepth = APPROACH_SCALE
    if (tilt < APPROACH_TILT_LERP_MIN) {
        let lo = -8
        let hi = 8
        for (let i = 0; i < 20; i++) {
            const mid = (lo + hi) / 2
            if (approachAtTilt(mid, tilt) < approachValue) {
                lo = mid
            } else {
                hi = mid
            }
        }
        return (lo + hi) / 2
    }

    return inverseApproachSlice(approachValue, tilt, spawnDepth)
}

export const widthFactorAtTilt = (depth: number, tilt: number) =>
    tilt * depth + (1 - tilt) * STAGE_WIDTH_MID

export const tiltWidthFactor = (context: PreviewLayout, depth: number) =>
    context.stageTilt * depth + context.widthOffset

export const tiltDepth = (context: PreviewLayout, lineY: number, travel: number) =>
    travel + (lineY - 1) * lerp(1, travel, context.stageTilt)

export const tiltWidenedEdge = (context: PreviewLayout, bottomEdge: number, topEdge: number) =>
    lerp(bottomEdge, topEdge, context.stageTilt)

export const transformVec = (context: PreviewLayout, v: Vec): Vec =>
    rotateVec(
        vec(v.x * context.wScale + context.xTranslate, v.y * context.hScale + context.t),
        -context.rotate,
    )

export const transformQuad = (context: PreviewLayout, q: Quad): Quad => ({
    bl: transformVec(context, q.bl),
    tl: transformVec(context, q.tl),
    tr: transformVec(context, q.tr),
    br: transformVec(context, q.br),
})

export const transformedVecAt = (context: PreviewLayout, lane: number, travel = 1): Vec =>
    transformVec(context, vec(lane * tiltWidthFactor(context, travel), travel))

export const preRotationVecAt = (context: PreviewLayout, lane: number, travel = 1): Vec =>
    vec(
        lane * tiltWidthFactor(context, travel) * context.wScale + context.xTranslate,
        travel * context.hScale + context.t,
    )

export const perspectiveVec = (context: PreviewLayout, x: number, y: number, travel = 1): Vec =>
    transformVec(context, vec(x * tiltWidthFactor(context, y * travel), y * travel))

export const perspectiveRect = (
    context: PreviewLayout,
    l: number,
    r: number,
    t: number,
    b: number,
    travel = 1,
): Quad => {
    const depthB = tiltDepth(context, b, travel)
    const depthT = tiltDepth(context, t, travel)
    const wb = tiltWidthFactor(context, depthB)
    const wt = tiltWidthFactor(context, depthT)
    return transformQuad(context, {
        bl: vec(l * wb, depthB),
        br: vec(r * wb, depthB),
        tl: vec(l * wt, depthT),
        tr: vec(r * wt, depthT),
    })
}

export type StageScreenTransform = AffineTransform & { elevation: number }

export const identityStageScreenTransform: StageScreenTransform = {
    ...identityAffineTransform,
    elevation: 0,
}

export type StageTransform = {
    sr: number
    px: number
    py: number
    tx: number
    ty: number
    projection: StageScreenTransform
}

export const identityStageTransform: StageTransform = {
    sr: 0,
    px: 0,
    py: 0,
    tx: 0,
    ty: 0,
    projection: identityStageScreenTransform,
}

export const stageTransformIsIdentity = (st: StageTransform) =>
    st.sr === 0 && st.tx === 0 && st.ty === 0 && st.projection.elevation === 0

export const stageTransformToAffineOrIdentity = (st?: StageTransform): StageScreenTransform =>
    !st || stageTransformIsIdentity(st) ? identityStageScreenTransform : stageTransformToAffine(st)

export const stageTransformToAffine = (st: StageTransform): StageScreenTransform => {
    const cs = Math.cos(st.sr)
    const sn = Math.sin(st.sr)
    const p = st.projection
    return {
        a00: cs * p.a00 + sn * p.a10,
        a01: cs * p.a01 + sn * p.a11,
        a02: cs * p.a02 + sn * p.a12 + st.px * (1 - cs) - sn * st.py + st.tx,
        a10: -sn * p.a00 + cs * p.a10,
        a11: -sn * p.a01 + cs * p.a11,
        a12: -sn * p.a02 + cs * p.a12 + st.py * (1 - cs) + sn * st.px + st.ty,
        elevation: p.elevation,
    }
}

// Keep decorations upright relative to the stage without flattening their geometry.
export const transformBillboard = (transform: AffineTransform, quad: Quad, anchor: Vec): Quad => {
    const x = transform.a00 + transform.a11
    const y = transform.a10 - transform.a01
    const magnitude = Math.hypot(x, y)
    const cs = magnitude > 0 ? x / magnitude : 1
    const sn = magnitude > 0 ? y / magnitude : 0
    const origin = applyAffine(transform, anchor)
    const place = (p: Vec): Vec => {
        const dx = p.x - anchor.x
        const dy = p.y - anchor.y
        return vec(origin.x + cs * dx - sn * dy, origin.y + sn * dx + cs * dy)
    }
    return { bl: place(quad.bl), br: place(quad.br), tl: place(quad.tl), tr: place(quad.tr) }
}

export const elevationProjection = (
    camera: LayoutTransform,
    elevation: number,
): StageScreenTransform => {
    const tilt = camera.stageTilt
    let amount = elevation * camera.wScale * tilt
    if (tilt > 0) amount = Math.min(amount, -camera.hScale / tilt)
    const scaleDelta = (amount * tilt) / camera.hScale
    const shift = amount * ((1 - tilt) * STAGE_WIDTH_MID - (tilt * camera.t) / camera.hScale)
    const cs = Math.cos(camera.rotate)
    const sn = Math.sin(camera.rotate)
    return {
        a00: 1 + scaleDelta * sn * sn,
        a01: scaleDelta * sn * cs,
        a02: shift * sn,
        a10: scaleDelta * sn * cs,
        a11: 1 + scaleDelta * cs * cs,
        a12: shift * cs,
        elevation: tilt > 0 ? amount / camera.wScale / tilt : 0,
    }
}

const stageRotationPivot = (camera: LayoutTransform, judgeDepth: number): Vec =>
    rotateVec(
        vec(camera.xTranslate, lerp(judgeDepth, 0, camera.stageTilt) * camera.hScale + camera.t),
        -camera.rotate,
    )

export const computeStageTransform = (
    context: PreviewViewport,
    camera: LayoutTransform,
    stageRotate: number,
    xLaneTranslate: number,
    yLaneTranslate: number,
    maskLane: number,
    centerWeight = 0,
    elevation = 0,
): StageTransform => {
    const travel = approachAtTilt(1, camera.stageTilt)
    const width = widthFactorAtTilt(travel, camera.stageTilt)
    const projection = elevationProjection(camera, elevation)
    const judgeCenter = applyAffine(
        projection,
        rotateVec(
            vec(
                maskLane * width * camera.wScale + camera.xTranslate,
                travel * camera.hScale + camera.t,
            ),
            -camera.rotate,
        ),
    )
    const baseT = context.fieldH * FIELD_T_FACTOR
    const baseH = context.fieldH * FIELD_B_FACTOR - baseT
    const centerJudgeY = camera.hScale * (travel + baseT / baseH)
    const offset = rotateVec(
        vec(
            xLaneTranslate * camera.wScale,
            yLaneTranslate * camera.wScale - centerWeight * centerJudgeY,
        ),
        -camera.rotate,
    )
    const pivot = applyAffine(projection, stageRotationPivot(camera, travel))
    const cs = Math.cos(stageRotate)
    const sn = Math.sin(stageRotate)
    const dx = judgeCenter.x - pivot.x
    const dy = judgeCenter.y - pivot.y
    return {
        sr: stageRotate,
        px: pivot.x,
        py: pivot.y,
        tx: offset.x + (1 - cs) * dx - sn * dy,
        ty: offset.y + (1 - cs) * dy + sn * dx,
        projection,
    }
}

// Both projections share the camera axis; extrapolation stops at zero height instead of flipping.
const stageProjectionBlendFrac = (
    a: StageScreenTransform,
    b: StageScreenTransform,
    frac: number,
) => {
    if (frac >= 0 && frac <= 1) return frac
    const traceA = a.a00 + a.a11
    const traceB = b.a00 + b.a11
    if (traceA !== traceB && lerp(traceA, traceB, frac) < 1) return (1 - traceA) / (traceB - traceA)
    return frac
}

export const blendStageTransform = (
    a: StageTransform,
    b: StageTransform,
    frac: number,
): StageTransform => {
    const projectionFrac = stageProjectionBlendFrac(a.projection, b.projection, frac)
    return {
        sr: lerp(a.sr, b.sr, frac),
        px: lerp(a.px, b.px, frac),
        py: lerp(a.py, b.py, frac),
        tx: lerp(a.tx, b.tx, frac),
        ty: lerp(a.ty, b.ty, frac),
        projection: {
            a00: lerp(a.projection.a00, b.projection.a00, projectionFrac),
            a01: lerp(a.projection.a01, b.projection.a01, projectionFrac),
            a02: lerp(a.projection.a02, b.projection.a02, projectionFrac),
            a10: lerp(a.projection.a10, b.projection.a10, projectionFrac),
            a11: lerp(a.projection.a11, b.projection.a11, projectionFrac),
            a12: lerp(a.projection.a12, b.projection.a12, projectionFrac),
            elevation: lerp(a.projection.elevation, b.projection.elevation, projectionFrac),
        },
    }
}

export const layoutSekaiStage = (context: PreviewLayout): Quad => {
    const w = ((2048 / 1420) * 12) / 2
    const h = 1176 / 850
    return transformQuad(context, {
        bl: vec(-w, LANE_T + h),
        br: vec(w, LANE_T + h),
        tl: vec(-w, LANE_T),
        tr: vec(w, LANE_T),
    })
}

export const layoutStageLaneByEdges = (
    context: PreviewLayout,
    l: number,
    r: number,
    yOffset = 0,
): Quad =>
    perspectiveRect(
        context,
        l,
        r,
        context.stageLaneT,
        context.stageLaneB,
        approach(context, 1 - yOffset),
    )

export const layoutNoteBodyByEdges = (
    context: PreviewLayout,
    l: number,
    r: number,
    h: number,
    travel: number,
): Quad => perspectiveRect(context, l, r, 1 - h, 1 + h, travel)

export const layoutNoteBodySlicesByEdges = (
    context: PreviewLayout,
    l: number,
    r: number,
    h: number,
    edgeW: number,
    travel: number,
): [Quad, Quad, Quad] => {
    const m = (l + r) / 2
    if (r < l) l = r = m
    const ml = Math.min(l + edgeW, m)
    const mr = Math.max(r - edgeW, m)
    return [
        layoutNoteBodyByEdges(context, l, ml, h, travel),
        layoutNoteBodyByEdges(context, ml, mr, h, travel),
        layoutNoteBodyByEdges(context, mr, r, h, travel),
    ]
}

export const layoutRegularNoteBody = (
    context: PreviewLayout,
    lane: number,
    size: number,
    travel: number,
) =>
    layoutNoteBodySlicesByEdges(
        context,
        lane - size,
        lane + size,
        context.noteH,
        NOTE_EDGE_W,
        travel,
    )

export const layoutRegularNoteBodyFallback = (
    context: PreviewLayout,
    lane: number,
    size: number,
    travel: number,
) => layoutNoteBodyByEdges(context, lane - size, lane + size, context.noteH, travel)

export const layoutSlimNoteBody = (
    context: PreviewLayout,
    lane: number,
    size: number,
    travel: number,
) =>
    layoutNoteBodySlicesByEdges(
        context,
        lane - size,
        lane + size,
        context.noteH,
        NOTE_SLIM_EDGE_W,
        travel,
    )

export const layoutSlimNoteBodyFallback = (
    context: PreviewLayout,
    lane: number,
    size: number,
    travel: number,
) => layoutNoteBodyByEdges(context, lane - size, lane + size, context.noteH / 2, travel)

export const layoutTick = (context: PreviewLayout, lane: number, travel: number): Quad => {
    const center = transformedVecAt(context, lane, travel)
    const h = -context.scaledNoteH * tiltWidthFactor(context, travel)
    const rot = -context.rotate
    const dx = rotateVec(vec(h, 0), rot)
    const dy = rotateVec(vec(0, h), rot)
    return {
        bl: vec(center.x - dx.x - dy.x, center.y - dx.y - dy.y),
        tl: vec(center.x - dx.x + dy.x, center.y - dx.y + dy.y),
        tr: vec(center.x + dx.x + dy.x, center.y + dx.y + dy.y),
        br: vec(center.x + dx.x - dy.x, center.y + dx.y - dy.y),
    }
}

export const layoutFlickArrow = (
    context: PreviewLayout,
    lane: number,
    size: number,
    direction: FlickDirectionValue,
    travel: number,
    animationProgress: number,
): Quad => {
    let isDown = false
    let reverse = false
    let animationTopXOffset = 0
    switch (direction) {
        case FlickDirection.upOmni:
            break
        case FlickDirection.downOmni:
            isDown = true
            break
        case FlickDirection.upLeft:
            animationTopXOffset = -1
            break
        case FlickDirection.upRight:
            reverse = true
            animationTopXOffset = 1
            break
        case FlickDirection.downLeft:
            isDown = true
            animationTopXOffset = 1
            break
        case FlickDirection.downRight:
            isDown = true
            reverse = true
            animationTopXOffset = -1
            break
    }

    const w = clamp(size, 0, 3) / 2
    const baseBl = transformedVecAt(context, lane - w, travel)
    const baseBr = transformedVecAt(context, lane + w, travel)
    const up = rotateVec(subVec(baseBr, baseBl), Math.PI / 2)
    const baseTl = vec(baseBl.x + up.x, baseBl.y + up.y)
    const baseTr = vec(baseBr.x + up.x, baseBr.y + up.y)
    const offsetScale = isDown ? 1 - animationProgress : animationProgress
    const offsetBase = rotateVec(
        vec(animationTopXOffset * context.wScale, 2 * context.wScale),
        -context.rotate,
    )
    const factor = offsetScale * tiltWidthFactor(context, travel)
    const offset = vec(offsetBase.x * factor, offsetBase.y * factor)

    const result = translateQuad({ bl: baseBl, br: baseBr, tl: baseTl, tr: baseTr }, offset)
    if (reverse) {
        return { bl: result.br, br: result.bl, tl: result.tr, tr: result.tl }
    }
    return result
}

export const layoutFlickArrowFallback = (
    context: PreviewLayout,
    lane: number,
    size: number,
    direction: FlickDirectionValue,
    travel: number,
    animationProgress: number,
): Quad => {
    let rotation = 0
    let animationTopXOffset = 0
    let isDown = false
    switch (direction) {
        case FlickDirection.upOmni:
            break
        case FlickDirection.downOmni:
            rotation = Math.PI
            isDown = true
            break
        case FlickDirection.upLeft:
            rotation = Math.PI / 6
            animationTopXOffset = -1
            break
        case FlickDirection.upRight:
            rotation = -Math.PI / 6
            animationTopXOffset = 1
            break
        case FlickDirection.downLeft:
            rotation = (Math.PI * 5) / 6
            animationTopXOffset = 1
            isDown = true
            lane -= 0.25
            break
        case FlickDirection.downRight:
            rotation = (-Math.PI * 5) / 6
            animationTopXOffset = -1
            isDown = true
            lane += 0.25
            break
    }

    const w = clamp(size / 2, 1, 2)
    const offsetScale = isDown ? 1 - animationProgress : animationProgress
    const width = tiltWidthFactor(context, travel)
    const offset = vec(
        animationTopXOffset * context.wScale * offsetScale * width,
        2 * context.wScale * offsetScale * width,
    )
    const scale = w * context.wScale * width
    const center = transformedVecAt(context, lane, travel)

    const corner = (x: number, y: number): Vec => {
        let p = rotateVec(vec(x, y), rotation)
        p = vec(p.x * scale + offset.x, p.y * scale + offset.y)
        p = rotateVec(p, -context.rotate)
        return vec(p.x + center.x, p.y + center.y)
    }

    return {
        bl: corner(-1, -1),
        tl: corner(-1, 1),
        tr: corner(1, 1),
        br: corner(1, -1),
    }
}

export const layoutLinearEffect = (
    context: PreviewLayout,
    lane: number,
    shear: number,
    yOffset = 0,
): Quad => {
    const w = 1
    const travel = approach(context, 1 - yOffset)
    const bl = transformedVecAt(context, lane - w, travel)
    const br = transformedVecAt(context, lane + w, travel)
    const d = subVec(br, bl)
    const shearScale = (shear + 0.125 * lane) / 2
    const up = vec(
        -d.y + d.x * shearScale, // rotate(d, pi/2) + shearScale * d
        d.x + d.y * shearScale,
    )
    return {
        bl,
        br,
        tl: vec(bl.x + up.x, bl.y + up.y),
        tr: vec(br.x + up.x, br.y + up.y),
    }
}

export const layoutRotatedLinearEffect = (
    context: PreviewLayout,
    lane: number,
    shear: number,
    yOffset = 0,
): Quad => {
    const w = 1
    const travel = approach(context, 1 - yOffset)
    const bl = transformedVecAt(context, lane - w, travel)
    const br = transformedVecAt(context, lane + w, travel)
    const d = subVec(br, bl)
    const up = vec(-d.y, d.x)
    const angle = Math.atan(-(shear + 0.125 * lane) / 2)
    const pivot = vec((bl.x + br.x) / 2, (bl.y + br.y) / 2)

    const rotateAbout = (p: Vec): Vec => {
        const rotated = rotateVec(vec(p.x - pivot.x, p.y - pivot.y), angle)
        return vec(rotated.x + pivot.x, rotated.y + pivot.y)
    }

    return {
        bl: rotateAbout(bl),
        br: rotateAbout(br),
        tl: rotateAbout(vec(bl.x + up.x, bl.y + up.y)),
        tr: rotateAbout(vec(br.x + up.x, br.y + up.y)),
    }
}

export const layoutCircularEffect = (
    context: PreviewLayout,
    lane: number,
    w: number,
    h: number,
    yOffset = 0,
): Quad => {
    const travel = approach(context, 1 - yOffset)
    const width = tiltWidthFactor(context, travel)
    w *= width
    h *= context.wScale / context.hScale
    const t = travel + h * width
    const b = travel - h * width
    const wb = tiltWidthFactor(context, b)
    const wt = tiltWidthFactor(context, t)
    return transformQuad(context, {
        bl: vec(lane * wb - w, b),
        br: vec(lane * wb + w, b),
        tl: vec(lane * wt - w, t),
        tr: vec(lane * wt + w, t),
    })
}

export const layoutTickEffect = (context: PreviewLayout, lane: number, yOffset = 0): Quad => {
    const travel = approach(context, 1 - yOffset)
    const w = 4 * context.wScale * tiltWidthFactor(context, travel)
    const center = transformedVecAt(context, lane, travel)
    const rot = -context.rotate
    const dx = rotateVec(vec(w, 0), rot)
    const dy = rotateVec(vec(0, w), rot)
    return {
        bl: vec(center.x - dx.x - dy.x, center.y - dx.y - dy.y),
        tl: vec(center.x - dx.x + dy.x, center.y - dx.y + dy.y),
        tr: vec(center.x + dx.x + dy.x, center.y + dx.y + dy.y),
        br: vec(center.x + dx.x - dy.x, center.y + dx.y - dy.y),
    }
}

export const layoutParticleLane = (
    context: PreviewLayout,
    lane: number,
    size: number,
    yOffset = 0,
    extendDown = true,
    compensateOvershoot = true,
): Quad => {
    const travel = approach(context, 1 - yOffset)
    let top = Math.max(tiltDepth(context, context.laneT, travel), context.safeLaneT)
    let bottom = context.laneB
    if (extendDown) bottom = lerp(bottom, context.stageLaneB, 0.25 * context.stageTilt)
    bottom = Math.max(tiltDepth(context, bottom, travel), top)
    if (compensateOvershoot) {
        top = Math.max(top, lerp(context.safeLaneT, bottom, 0.07 / 1.07))
    }
    return {
        bl: transformedVecAt(context, lane - size, bottom),
        br: transformedVecAt(context, lane + size, bottom),
        tl: transformedVecAt(context, lane - size, top),
        tr: transformedVecAt(context, lane + size, top),
    }
}

export const layoutSlotEffect = (context: PreviewLayout, lane: number, yOffset = 0): Quad => {
    const travel = approach(context, 1 - yOffset)
    const nh = context.noteH
    return perspectiveRect(context, lane - 0.5, lane + 0.5, 1 - nh, 1 + nh, travel)
}

export const layoutSlotGlowEffect = (
    context: PreviewLayout,
    lane: number,
    size: number,
    height: number,
    yOffset = 0,
): Quad => {
    const s = 1.25
    const travel = approach(context, 1 - yOffset)
    const h = 4.25 * context.wScale * tiltWidthFactor(context, travel)
    const up = rotateVec(vec(0, h), -context.rotate)
    const lMin = transformedVecAt(context, lane - size, travel)
    const rMin = transformedVecAt(context, lane + size, travel)
    const lMax = transformedVecAt(context, (lane - size) * s, travel)
    const rMax = transformedVecAt(context, (lane + size) * s, travel)
    return {
        bl: lMin,
        br: rMin,
        tl: vec(lerp(lMin.x, lMax.x + up.x, height), lerp(lMin.y, lMax.y + up.y, height)),
        tr: vec(lerp(rMin.x, rMax.x + up.x, height), lerp(rMin.y, rMax.y + up.y, height)),
    }
}

export const iterSlotLanes = (
    lane: number,
    size: number,
    pivotLane = 0,
    halfOffset = false,
): number[] => {
    const e = 1e-6
    const offset = halfOffset ? 0 : 0.5
    const shift = pivotLane + offset - 0.5
    const shiftedLane = lane - shift
    const lanes: number[] = []
    for (let i = Math.floor(shiftedLane - size + e); i < Math.ceil(shiftedLane + size - e); i++) {
        lanes.push(i + 0.5 + shift)
    }
    return lanes
}

export const layoutSlideConnectorSegment = (
    context: PreviewLayout,
    startLane: number,
    startSize: number,
    startTravel: number,
    endLane: number,
    endSize: number,
    endTravel: number,
): Quad => {
    if (startTravel < endTravel) {
        ;[startLane, endLane] = [endLane, startLane]
        ;[startSize, endSize] = [endSize, startSize]
        ;[startTravel, endTravel] = [endTravel, startTravel]
    }
    return {
        bl: perspectiveVec(context, startLane - startSize, 1, startTravel),
        br: perspectiveVec(context, startLane + startSize, 1, startTravel),
        tl: perspectiveVec(context, endLane - endSize, 1, endTravel),
        tr: perspectiveVec(context, endLane + endSize, 1, endTravel),
    }
}
