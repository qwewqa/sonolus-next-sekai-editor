import type { PreviewSlide } from './model'

const endIndexes = new WeakMap<PreviewSlide, Float64Array>()

// The head and each surviving particle sample the slide at different times.
// Cache prefix maxima so all of them can find the first unfinished connector
// without repeatedly walking every preceding segment. Prefix maxima retain
// source order even for tied or overlapping endpoints.
export const findSlideConnector = (slide: PreviewSlide, time: number) => {
    let ends = endIndexes.get(slide)
    if (!ends) {
        ends = new Float64Array(slide.connectors.length)
        let maximum = -Infinity
        for (const [index, connector] of slide.connectors.entries()) {
            maximum = Math.max(maximum, connector.tail.targetTime)
            ends[index] = maximum
        }
        endIndexes.set(slide, ends)
    }

    let left = 0
    let right = ends.length
    while (left < right) {
        const middle = (left + right) >>> 1
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        if (ends[middle]! <= time) left = middle + 1
        else right = middle
    }
    return slide.connectors[left]
}
