import type { NoteEntity } from '../../state/entities/slides/note'

export type ElevationNote = {
    note: NoteEntity
    lane: number
    size: number
    elevation: number
    attached: boolean
    order: number
}
export type ElevationRow = ElevationNote & { x: number; y: number; w: number; trueY: number }
export type ElevationAxes = {
    width: number
    height: number
    laneLeft: number
    laneScale: number
    elevationCenter: number
    elevationScale: number
}
export const sameBeat = (a: number, b: number) => Math.abs(a - b) < 1e-7
export const snapElevation = (value: number, division: number) =>
    division > 0 ? Math.round(value * division) / division : value

export const layoutElevationNotes = (notes: ElevationNote[], axes: ElevationAxes) => {
    const { laneLeft, laneScale, height, elevationCenter, elevationScale } = axes
    const xAt = (lane: number) => (lane - laneLeft) * laneScale
    const yAt = (elevation: number) => height / 2 - (elevation - elevationCenter) * elevationScale
    const rows: ElevationRow[] = []
    const spacing = Math.max(30, laneScale * 0.6 + 16)
    const bucketWidth = Math.max(32, laneScale * 1.5 + 8)
    const buckets = new Map<string, number[]>()
    const wideRows: number[] = []
    const precedingBySlide = new Map<NoteEntity['slideId'], ElevationRow>()
    const repeatedFootprints = new Map<string, number>()
    const bucketRange = (x: number, w: number) => {
        const halfWidth = Math.max(w, laneScale * 1.5) / 2 + 4
        const from = Math.floor((x - halfWidth) / bucketWidth)
        const to = Math.floor((x + halfWidth) / bucketWidth)
        return Number.isSafeInteger(from) && Number.isSafeInteger(to) && to - from < 128
            ? { from, to }
            : undefined
    }
    for (const item of [...notes].sort((a, b) => a.elevation - b.elevation || a.order - b.order)) {
        const x = xAt(item.lane)
        const w = item.size * laneScale
        const trueY = yAt(item.elevation)
        const preceding = precedingBySlide.get(item.note.slideId)
        let y =
            preceding && sameBeat(preceding.elevation, item.elevation)
                ? Math.min(trueY, preceding.y) - spacing
                : trueY
        const footprint =
            y === trueY && Number.isFinite(x) && Number.isFinite(w) && Number.isFinite(y)
                ? `${x},${Math.max(w, laneScale * 1.5)},${trueY}`
                : undefined
        const precedingFootprintY =
            footprint === undefined ? undefined : repeatedFootprints.get(footprint)
        if (precedingFootprintY !== undefined) y = precedingFootprintY - spacing
        const range = bucketRange(x, w)
        for (;;) {
            const collides = (row: ElevationRow) =>
                Math.abs(row.x - x) <
                    (Math.max(row.w, laneScale * 1.5) + Math.max(w, laneScale * 1.5)) / 2 + 8 &&
                row.y - spacing < y &&
                y < row.y + spacing
            const bucketY = Math.floor(y / spacing)
            let collision: ElevationRow | undefined
            if (!range || !Number.isSafeInteger(bucketY)) {
                collision = rows.find(collides)
            } else {
                let index = rows.length
                const check = (candidate: number) => {
                    const row = rows[candidate]
                    if (candidate < index && row && collides(row)) index = candidate
                }
                for (const candidate of wideRows) check(candidate)
                for (let bx = range.from; bx <= range.to; bx++) {
                    for (const offset of [-1, 0, 1]) {
                        const by = bucketY + offset
                        for (const candidate of buckets.get(`${bx},${by}`) ?? []) check(candidate)
                    }
                }
                collision = rows[index]
            }
            if (!collision) break
            y = collision.y - spacing
        }
        const row = { ...item, x, y, w, trueY }
        const bucketY = Math.floor(y / spacing)
        const index = rows.length
        rows.push(row)
        precedingBySlide.set(item.note.slideId, row)
        if (footprint !== undefined) repeatedFootprints.set(footprint, y)
        if (!range || !Number.isSafeInteger(bucketY)) {
            wideRows.push(index)
        } else {
            for (let bx = range.from; bx <= range.to; bx++) {
                const key = `${bx},${bucketY}`
                const bucket = buckets.get(key)
                if (bucket) bucket.push(index)
                else buckets.set(key, [index])
            }
        }
    }
    return { rows, xAt, yAt, ...axes }
}
