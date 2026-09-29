import type { PreviewLayout } from './layout'

// Historical effects use their own layout while retaining the frame's layer time.
export type PreviewFrameContext = Readonly<{
    now: number
    layout: PreviewLayout
}>
