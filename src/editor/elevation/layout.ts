import type { NoteEntity } from '../../state/entities/slides/note'

export type ElevationNote = {
    note: NoteEntity
    lane: number
    size: number
    elevation: number
    attached: boolean
    order: number
}
export type ElevationRow = ElevationNote & { x: number; y: number; w: number }
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
    const rows = [...notes]
        .sort((a, b) => a.elevation - b.elevation || a.order - b.order)
        .map((item) => ({
            ...item,
            x: xAt(item.lane),
            y: yAt(item.elevation),
            w: item.size * laneScale,
        }))
    return { rows, xAt, yAt, ...axes }
}
