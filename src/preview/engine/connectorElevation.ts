import { CONNECTOR_CURVE_ERROR } from './connectorCurve'
import { lerp, type Vec } from './math'

export type ElevationConnectorSample = {
    edges: readonly Vec[]
    rotation: number
}

// Match elevation_connector_fracs in sekai/lib/connector.py. Sample actual screen
// edges: authored lane changes alone cannot describe moving or rotated stages.
export const elevationConnectorFracs = (
    sample: (fraction: number) => ElevationConnectorSample,
    quality: number,
    minimumDetail = 0,
) => {
    if (quality <= 0) return [1]
    const toleranceSquared = (CONNECTOR_CURVE_ERROR / (2 * quality * quality)) ** 2
    const fractions: number[] = []
    const stack = [{ fraction: 1, sample: sample(1), depth: 0 }]
    let firstFraction = 0
    let first = sample(0)
    while (stack.length) {
        const last = stack.pop()
        if (!last) break
        let error = 0
        let minRotation = Math.min(first.rotation, last.sample.rotation)
        let maxRotation = Math.max(first.rotation, last.sample.rotation)
        let middle: ElevationConnectorSample | undefined
        for (const fraction of [0.25, 0.5, 0.75]) {
            const current = sample(lerp(firstFraction, last.fraction, fraction))
            if (fraction === 0.5) middle = current
            minRotation = Math.min(minRotation, current.rotation)
            maxRotation = Math.max(maxRotation, current.rotation)
            for (const [index, edge] of current.edges.entries()) {
                const start = first.edges[index]
                const end = last.sample.edges[index]
                if (!start || !end) continue
                error = Math.max(
                    error,
                    (edge.x - lerp(start.x, end.x, fraction)) ** 2 +
                        (edge.y - lerp(start.y, end.y, fraction)) ** 2,
                )
            }
        }
        if (
            (error <= toleranceSquared &&
                maxRotation - minRotation <= Math.PI / 4 &&
                (last.fraction - firstFraction) * minimumDetail <= 1) ||
            last.depth >= 16
        ) {
            fractions.push(last.fraction)
            firstFraction = last.fraction
            first = last.sample
        } else if (fractions.length + stack.length + 2 > 128) {
            // Uniform full-span coverage avoids starving the tail of a difficult
            // curve when the depth-first adaptive budget is exhausted.
            return Array.from({ length: 128 }, (_, index) => (index + 1) / 128)
        } else if (middle) {
            stack.push({ ...last, depth: last.depth + 1 })
            stack.push({
                fraction: (firstFraction + last.fraction) / 2,
                sample: middle,
                depth: last.depth + 1,
            })
        }
    }
    return fractions
}
