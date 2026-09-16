import type { GroupId } from '../../chart/groups'
import type { State } from '../../state'

export type CanvasBounds = {
    l: number
    r: number
    t: number
    b: number
    w: number
    h: number
}

// Drawing functions use editor scene coordinates. The caller installs the
// viewport transform; scale converts scene units to CSS pixels.
export type EditorDrawContext = {
    ctx: CanvasRenderingContext2D
    scale: number
    pixelRatio: number
    bounds: CanvasBounds
    ups: number
    state: State
    defaultGroupId: GroupId | undefined
    showStageName: boolean
    showGroupName: boolean
    recentlyActive: boolean
    fontFamily: string
}
