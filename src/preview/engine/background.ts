import {
    TARGET_ASPECT_RATIO,
    cameraZoomAnchor,
    cameraZoomTargetAt,
    type CameraChange,
    type CameraInfo,
    type PreviewViewport,
} from './layout'
import { easeOvershoot, rotateVec, vec, type Quad } from './math'

// Compiled camera arrays are immutable. Scanning the whole chart for overscan
// belongs to chart changes, not each playback frame or seek.
const rotationLimits = new WeakMap<readonly CameraChange[], number>()
const rotationLimit = (cameras: readonly CameraChange[]) => {
    let limit = rotationLimits.get(cameras)
    if (limit === undefined) {
        limit = 0
        for (const [index, camera] of cameras.entries()) {
            const next = cameras[index + 1]
            // Overshooting eases rotate past their endpoints.
            const overshoot = next
                ? easeOvershoot(camera.ease) * Math.abs(next.rotate - camera.rotate)
                : 0
            limit = Math.max(limit, Math.abs(camera.rotate) + overshoot)
            if (next) limit = Math.max(limit, Math.abs(next.rotate) + overshoot)
        }
        rotationLimits.set(cameras, limit)
    }
    return Math.min(limit, Math.PI / 2)
}

// Matches sekai/lib/layout.py: background_camera_zoom and apply_camera_zoom.
// The bundled background is 16:9; fit the complete image before camera motion
// so wider/taller viewports retain the same crop and rotation coverage as game.
export const layoutBackground = (
    viewport: PreviewViewport,
    cameras: readonly CameraChange[],
    camera: CameraInfo,
    imageAspectRatio = TARGET_ASPECT_RATIO,
): Quad => {
    const a = viewport.screenW / 2
    const b = viewport.screenH / 2
    let halfWidth = Math.max(a, b * imageAspectRatio)
    let halfHeight = halfWidth / imageAspectRatio

    if (cameras.length) {
        const theta = rotationLimit(cameras)
        const diagonal = Math.hypot(a, b)
        const coverX =
            theta >= Math.atan(b / a) ? diagonal : a * Math.cos(theta) + b * Math.sin(theta)
        const coverY =
            theta >= Math.atan(a / b) ? diagonal : a * Math.sin(theta) + b * Math.cos(theta)
        const raisedTarget = cameraZoomTargetAt(viewport, 0, 6, 0, 0.5, 0)
        const raisedAnchor = cameraZoomAnchor(viewport, 1)
        const laneTarget = cameraZoomTargetAt(viewport, 0, 6, 1, 0, 1)
        const laneAnchor = cameraZoomAnchor(viewport, 0)
        const marginX = Math.max(
            Math.abs(raisedTarget.x - raisedAnchor.x),
            Math.abs(laneTarget.x - laneAnchor.x),
        )
        const marginY = Math.max(
            Math.abs(raisedTarget.y - raisedAnchor.y),
            Math.abs(laneTarget.y - laneAnchor.y),
        )
        const overscan = Math.max(
            (coverX + marginX) / halfWidth,
            (coverY + marginY) / halfHeight,
            1,
        )
        halfWidth *= overscan
        halfHeight *= overscan
    }

    const place = (x: number, y: number) =>
        rotateVec(
            vec(
                camera.zoom * (x - camera.zoomTarget.x) + camera.zoomAnchor.x,
                camera.zoom * (y - camera.zoomTarget.y) + camera.zoomAnchor.y,
            ),
            -camera.rotate,
        )
    return {
        bl: place(-halfWidth, -halfHeight),
        tl: place(-halfWidth, halfHeight),
        tr: place(halfWidth, halfHeight),
        br: place(halfWidth, -halfHeight),
    }
}
