import { clamp } from '../../utils/math'

export const panelIds = ['preview', 'groups', 'stages', 'properties'] as const
export type PanelId = (typeof panelIds)[number]

export const panelPositions = ['auto', 'left', 'right', 'top', 'disabled'] as const
export type PanelPosition = (typeof panelPositions)[number]

export const dockSides = ['left', 'top', 'right'] as const
export type DockSide = (typeof dockSides)[number]

export const isPanelId = (value: unknown): value is PanelId => panelIds.includes(value as PanelId)

/** Thickness of a dock's tab rail; coarse pointers get larger touch targets. */
export const railSize = 36
export const coarseRailSize = 44
/**
 * Thickness of the gap between tiles, where the dock's chrome shows through
 * so each panel reads as its own surface.
 */
export const separatorSize = 4

// Smallest tile lengths along a dock's stacking axis that still leave legible,
// usable content. Side docks stack vertically; the top dock arranges in a row.
const minTileLength: Record<'vertical' | 'horizontal', Record<PanelId, number>> = {
    vertical: { preview: 200, groups: 226, stages: 226, properties: 220 },
    horizontal: { preview: 220, groups: 260, stages: 260, properties: 260 },
}
const defaultWeights: Record<PanelId, number> = {
    preview: 1,
    groups: 1,
    stages: 1,
    properties: 1.5,
}
// Room reserved for the preview's single-row playback strip beneath its
// letterboxed canvas; touch screens use taller buttons.
const previewStrip = (input: WorkspaceLayoutInput) => (input.coarse ? 60 : 52)
const previewChrome = (input: WorkspaceLayoutInput) =>
    input.previewOverlay ? 0 : previewStrip(input)

const minSideBody = 220
const minTopBody = 176

export type WorkspaceLayoutInput = {
    width: number
    height: number
    positions: Record<PanelId, PanelPosition>
    open: Record<PanelId, boolean>
    /** Most recently activated first. */
    recency: readonly PanelId[]
    sizes: Record<DockSide, number>
    weights: Partial<Record<PanelId, number>>
    previewAspectRatio: number
    /** Shape used to resolve Auto positions; defaults to the workspace size. */
    autoShape?: { width: number; height: number }
    /** Collapsed docks show only their rail but keep open states. */
    collapsed?: Partial<Record<DockSide, boolean>>
    railSize?: number
    /** Touch screens get larger rails and preview controls. */
    coarse?: boolean
    /** Whether the playback strip always shows over the image, needing no room. */
    previewOverlay?: boolean
    /** Root font size in pixels, which scales the default side dock width. */
    rootFontSize?: number
}

export type DockTile = {
    id: PanelId
    /** Length along the dock's stacking axis. */
    size: number
    min: number
    weight: number
}

export type DockLayout = {
    side: DockSide
    /** Every enabled panel placed in this dock, in tab order. */
    panels: PanelId[]
    open: PanelId[]
    /** Visible panels in tab order. */
    visible: PanelId[]
    /** Open panels that do not fit beside the visible ones, in tab order. */
    covered: PanelId[]
    collapsed: boolean
    /**
     * Collapsed only because the other side dock holds the room beside the
     * editor, not because the dock was folded.
     */
    suppressed: boolean
    /**
     * Too narrow to sit beside the editor at a useful size, the body opens as a
     * drawer over the editor instead. Display only; preferences are unchanged.
     */
    overlay: boolean
    tiles: DockTile[]
    /** Displayed body thickness (width for side docks, height for the top dock). */
    size: number
    min: number
    max: number
    default: number
    /** Length of the stacking axis available to tiles. */
    length: number
}

export type WorkspaceLayout = {
    docks: Partial<Record<DockSide, DockLayout>>
    sides: Partial<Record<PanelId, DockSide>>
}

/**
 * Auto placement follows the usable shape of the workspace rather than a width
 * breakpoint alone: portrait screens of any width share a top dock, while
 * landscape screens use side docks, splitting them only when both sides and the
 * editor remain comfortably wide.
 */
export const resolveAutoSide = (width: number, height: number, id: PanelId): DockSide => {
    if (width < 640 || width < height) return 'top'
    if (id === 'properties' && width >= 1100) return 'right'
    return 'left'
}

export const resolvePanelSide = (
    position: PanelPosition,
    id: PanelId,
    shape: { width: number; height: number },
): DockSide | undefined => {
    if (position === 'disabled') return
    if (position === 'auto') return resolveAutoSide(shape.width, shape.height, id)
    return position
}

const editorMinWidth = (width: number) => Math.min(320, Math.round(width * 0.4))
// Short screens still leave the editor room below its toolbar.
const editorMinHeight = (height: number) =>
    Math.min(240, Math.max(Math.round(height * 0.4), Math.min(200, Math.round(height * 0.55))))

/**
 * Default dock sizes. A side dock's default never depends on the other side,
 * so showing or hiding one dock does not resize its neighbor. Side docks aim for
 * 24rem, at most a quarter of the width but never below 260.
 */
export const defaultDockSize = (side: DockSide, width: number, height: number, rem = 16) =>
    side === 'top'
        ? Math.round(clamp(height * 0.38, 180, 420))
        : Math.round(Math.max(260, Math.min(24 * rem, width * 0.25)))

/**
 * Distributes `length` between tiles by weight while honoring each tile's
 * minimum. When minimums cannot all fit, they shrink proportionally.
 */
export const distribute = (length: number, tiles: { min: number; weight: number }[]) => {
    const sizes = tiles.map(() => 0)
    const totalMin = tiles.reduce((sum, tile) => sum + tile.min, 0)
    if (totalMin >= length) {
        return tiles.map((tile) => (totalMin ? (length * tile.min) / totalMin : 0))
    }

    const fixed = new Set<number>()
    for (;;) {
        const free = tiles.flatMap((_, index) => (fixed.has(index) ? [] : [index]))
        const remaining = length - [...fixed].reduce((sum, index) => sum + (sizes[index] ?? 0), 0)
        const weight = free.reduce((sum, index) => sum + (tiles[index]?.weight ?? 0), 0)
        let changed = false
        for (const index of free) {
            const tile = tiles[index]
            if (!tile) continue
            const size = weight > 0 ? (remaining * tile.weight) / weight : remaining / free.length
            if (size < tile.min) {
                sizes[index] = tile.min
                fixed.add(index)
                changed = true
            } else {
                sizes[index] = size
            }
        }
        if (!changed) return sizes
    }
}

const tileWeight = (
    id: PanelId,
    input: WorkspaceLayoutInput,
    axis: 'vertical' | 'horizontal',
    cross: number,
    length: number,
    others: PanelId[],
) => {
    const explicit = input.weights[id]
    if (explicit !== undefined && explicit > 0) return explicit
    if (id !== 'preview' || !others.length) return defaultWeights[id]

    // Until the user adjusts a stack, give Preview its natural letterboxed size
    // and share the rest of the dock between the other panels.
    const natural =
        axis === 'vertical'
            ? cross / input.previewAspectRatio + previewChrome(input)
            : (cross - previewChrome(input)) * input.previewAspectRatio
    const share = clamp(natural / length, 0.2, 0.6)
    const rest = others.reduce(
        (sum, other) => sum + (input.weights[other] ?? defaultWeights[other]),
        0,
    )
    return (share / (1 - share)) * rest
}

const layoutDock = (
    side: DockSide,
    input: WorkspaceLayoutInput,
    sides: Partial<Record<PanelId, DockSide>>,
    size: { value: number; min: number; max: number; default: number },
    length: number,
    overlay = false,
    suppressed = false,
): DockLayout => {
    // A dock without room beside the other side's body shows only its rail,
    // like a collapsed one, until one of its panels is shown again.
    const collapsed = !!input.collapsed?.[side] || suppressed
    const axis = side === 'top' ? 'horizontal' : 'vertical'
    const panels = [...new Set(input.recency), ...panelIds]
    const inDock = (id: PanelId) => sides[id] === side
    const open = panelIds.filter((id) => inDock(id) && input.open[id])

    // Show the most recently activated open panels that fit at a useful size.
    const shown: PanelId[] = []
    let used = 0
    for (const id of panels) {
        if (collapsed) break
        if (!inDock(id) || !input.open[id] || shown.includes(id)) continue
        const need = minTileLength[axis][id] + (shown.length ? separatorSize : 0)
        if (shown.length && used + need > length) break
        shown.push(id)
        used += need
    }
    const visible = panelIds.filter((id) => shown.includes(id))

    const available = length - separatorSize * Math.max(0, visible.length - 1)
    const tiles = visible.map((id) => ({
        id,
        min: minTileLength[axis][id],
        weight: tileWeight(
            id,
            input,
            axis,
            size.value,
            available,
            visible.filter((other) => other !== id),
        ),
        size: 0,
    }))
    distribute(available, tiles).forEach((value, index) => {
        const tile = tiles[index]
        if (tile) tile.size = value
    })

    return {
        side,
        panels: panelIds.filter(inDock),
        open,
        visible,
        covered: collapsed ? [] : open.filter((id) => !visible.includes(id)),
        collapsed,
        suppressed: suppressed && !input.collapsed?.[side],
        overlay,
        tiles,
        size: visible.length ? size.value : 0,
        min: size.min,
        max: size.max,
        default: size.default,
        length,
    }
}

export const computeWorkspaceLayout = (input: WorkspaceLayoutInput): WorkspaceLayout => {
    const { width, height } = input
    const shape = input.autoShape ?? { width, height }
    const sides: Partial<Record<PanelId, DockSide>> = {}
    for (const id of panelIds) {
        const side = resolvePanelSide(input.positions[id], id, shape)
        if (side) sides[id] = side
    }

    const rail = input.railSize ?? railSize
    const has = (side: DockSide) => panelIds.some((id) => sides[id] === side)
    const hasBody = (side: DockSide) =>
        !input.collapsed?.[side] && panelIds.some((id) => sides[id] === side && input.open[id])

    // Side docks span the full height; the top dock sits between them, above
    // the editor. Each keeps the editor at a usable minimum size.
    const rails = (['left', 'right'] as const).filter(has).length * rail
    const sideBodies = (['left', 'right'] as const).filter(hasBody)
    const maxSideTotal = Math.max(0, width - rails - editorMinWidth(width))
    // When both sides cannot have a useful width beside the editor, only the
    // side with the most recently activated panel shows its body. When even
    // one cannot, that side opens as a drawer over the editor.
    // Decided among sides with open panels, collapsed or not, so collapsing the
    // shown side never brings the other side's panels into its place.
    const openSides = (['left', 'right'] as const).filter((side) =>
        panelIds.some((id) => sides[id] === side && input.open[id]),
    )
    const recentSide = input.recency
        .map((id) => sides[id])
        .find((side) => side !== 'top' && side !== undefined && openSides.includes(side))
    const fits = (count: number) => count * minSideBody <= maxSideTotal
    const suppressed = new Set<DockSide>()
    if (!fits(openSides.length))
        for (const side of sideBodies) if (side !== recentSide) suppressed.add(side)
    const inline = sideBodies.filter((side) => !suppressed.has(side))
    const overlay = !fits(inline.length)
    const sideSizes: Partial<Record<DockSide, { value: number; min: number; max: number }>> = {}
    if (overlay) {
        const max = Math.max(minSideBody, width - rails - 48)
        for (const side of inline) {
            const preferred =
                input.sizes[side] || defaultDockSize(side, width, height, input.rootFontSize)
            sideSizes[side] = { value: clamp(preferred, minSideBody, max), min: minSideBody, max }
        }
    } else {
        // Shrink both sides proportionally when their preferences do not fit,
        // and let each grow only into room the other is not using, so dragging
        // one side never squeezes the other.
        const preferred = inline.map((side) =>
            Math.max(
                minSideBody,
                input.sizes[side] || defaultDockSize(side, width, height, input.rootFontSize),
            ),
        )
        const total = preferred.reduce((sum, value) => sum + value, 0)
        const excess = total - inline.length * minSideBody
        const scale =
            total > maxSideTotal && excess > 0
                ? (maxSideTotal - inline.length * minSideBody) / excess
                : 1
        const values = preferred.map((value) => minSideBody + (value - minSideBody) * scale)
        for (const [index, side] of inline.entries()) {
            const others = values.reduce((sum, value, i) => (i === index ? sum : sum + value), 0)
            sideSizes[side] = {
                value: values[index] ?? minSideBody,
                min: minSideBody,
                max: Math.max(minSideBody, maxSideTotal - others),
            }
        }
    }

    const docks: Partial<Record<DockSide, DockLayout>> = {}
    for (const side of ['left', 'right'] as const) {
        if (!has(side)) continue
        const fallback = defaultDockSize(side, width, height, input.rootFontSize)
        const size = sideSizes[side] ?? { value: 0, min: minSideBody, max: maxSideTotal }
        docks[side] = layoutDock(
            side,
            input,
            sides,
            { ...size, default: fallback },
            height,
            overlay,
            suppressed.has(side),
        )
    }

    if (has('top')) {
        const centerWidth =
            width -
            (['left', 'right'] as const).reduce((sum, side) => {
                const dock = docks[side]
                return sum + (dock ? rail + (dock.overlay ? 0 : dock.size) : 0)
            }, 0)
        const max = Math.max(0, height - rail - editorMinHeight(height))
        const min = Math.min(minTopBody, max)
        const fallback = defaultDockSize('top', width, height)
        const size = (value: number) => ({ value, min, max, default: fallback })
        docks.top = layoutDock(
            'top',
            input,
            sides,
            size(clamp(input.sizes.top || fallback, min, max)),
            centerWidth,
        )
        // Until the user sizes it, a top dock holding Preview fits its
        // letterboxed image and playback bar instead of leaving empty bands.
        // It fits the width Preview has when shown, which is its own tile in a
        // row of tiles, whether or not Preview is open, so the height stays put
        // while switching tabs.
        if (!input.sizes.top && docks.top.panels.includes('preview')) {
            const shown = {
                ...input,
                open: { ...input.open, preview: true },
                recency: ['preview' as const, ...input.recency.filter((id) => id !== 'preview')],
            }
            // Preview's share of a row of tiles depends on the height, so
            // settle the two together; one more pass is within a pixel.
            for (let pass = 0; pass < 2; pass++) {
                const tile = layoutDock(
                    'top',
                    shown,
                    sides,
                    size(docks.top.size || fallback),
                    centerWidth,
                ).tiles.find(({ id }) => id === 'preview')
                const natural = Math.round(
                    (tile?.size ?? centerWidth) / input.previewAspectRatio + previewChrome(input),
                )
                // Never so short that the image is a sliver.
                const fitted = clamp(
                    Math.max(Math.min(fallback, natural), previewStrip(input) * 5),
                    min,
                    max,
                )
                if (fitted === docks.top.size) break
                docks.top = layoutDock('top', input, sides, size(fitted), centerWidth)
            }
        }
    }

    return { docks, sides }
}

/**
 * Converts a separator drag between two adjacent tiles into new weights for
 * just those tiles, preserving their combined weight.
 */
export const resizeTilePair = (a: DockTile, b: DockTile, sizeA: number) => {
    const total = a.size + b.size
    const nextA = clamp(sizeA, Math.min(a.min, total / 2), total - Math.min(b.min, total / 2))
    const weight = a.weight + b.weight
    return {
        [a.id]: (weight * nextA) / total,
        [b.id]: (weight * (total - nextA)) / total,
    } as Partial<Record<PanelId, number>>
}

/** Moves a panel to the front of the recency list. */
export const touchRecency = (recency: readonly PanelId[], id: PanelId): PanelId[] => [
    id,
    ...recency.filter((other) => other !== id),
]

/**
 * The action for a click on a panel's tab. Hiding the panel being looked at
 * never puts a different panel in its place: the only visible panel collapses
 * its dock (keeping open states, so one click restores everything), while one
 * of several visible panels closes and its siblings reflow.
 */
export const tabAction = (
    layout: WorkspaceLayout,
    open: Record<PanelId, boolean>,
    id: PanelId,
): 'expand' | 'collapse' | 'close' | 'activate' | 'open' => {
    const side = layout.sides[id]
    const dock = side ? layout.docks[side] : undefined
    if (dock?.collapsed) return 'expand'
    if (!open[id]) return 'open'
    if (!dock?.visible.includes(id)) return 'activate'
    return dock.visible.length > 1 ? 'close' : 'collapse'
}

/** The panel state that user actions change. */
export type WorkspaceToggleState = {
    open: Record<PanelId, boolean>
    /** Most recently activated first. */
    recency: readonly PanelId[]
    collapsed: Record<DockSide, boolean>
}

export type WorkspaceAction =
    /** A click on a panel's tab. */
    | { type: 'tab'; id: PanelId }
    /** Show a panel, as commands and status bar chips do. */
    | { type: 'show'; id: PanelId }
    | { type: 'close'; id: PanelId }
    /** The dock's chevron: fold it away, or restore what it showed. */
    | { type: 'toggleDock'; side: DockSide }

/**
 * Open panels that are not shown although their dock is not folded: covered
 * by more recent panels, or on a side dock held back for the other side. Their
 * tabs read as not shown, so user actions close them rather than let them
 * reappear later in place of a panel the user hides.
 */
export const hiddenOpenPanels = (layout: WorkspaceLayout) =>
    Object.values(layout.docks).flatMap((dock) =>
        dock.collapsed && !dock.suppressed
            ? []
            : dock.open.filter((id) => !dock.visible.includes(id)),
    )

/**
 * Applies a user action. A tab, command or close only ever affects the panel
 * it names: showing one never makes another appear, and hiding one never
 * reveals another in its place. Panels displaced to make room are closed, so
 * they cannot return on their own; only a dock's chevron restores several
 * panels at once, exactly as it folded them.
 */
export const reduceWorkspace = (
    state: WorkspaceToggleState,
    action: WorkspaceAction,
    layoutOf: (state: WorkspaceToggleState) => WorkspaceLayout,
): WorkspaceToggleState => {
    let next: WorkspaceToggleState = {
        open: { ...state.open },
        recency: [...state.recency],
        collapsed: { ...state.collapsed },
    }
    const close = (ids: readonly PanelId[]) => {
        if (!ids.length) return
        next = { ...next, open: { ...next.open } }
        for (const id of ids) next.open[id] = false
    }
    const settle = (keep?: PanelId) => {
        close(hiddenOpenPanels(layoutOf(next)).filter((id) => id !== keep))
    }
    const fold = (side: DockSide, collapsed: boolean) => {
        next = { ...next, collapsed: { ...next.collapsed, [side]: collapsed } }
    }

    const show = (id: PanelId) => {
        const layout = layoutOf(next)
        const side = layout.sides[id]
        const dock = side ? layout.docks[side] : undefined
        // A folded dock opens with just the panel asked for; its chevron is
        // what restores everything it held.
        if (dock?.collapsed && !dock.suppressed) close(dock.open.filter((other) => other !== id))
        settle(id)
        next = {
            ...next,
            open: { ...next.open, [id]: true },
            recency: touchRecency(next.recency, id),
        }
        if (side) fold(side, false)
        // Panels it displaced close rather than wait to return.
        settle()
    }

    switch (action.type) {
        case 'tab': {
            const layout = layoutOf(next)
            const side = layout.sides[action.id]
            switch (tabAction(layout, next.open, action.id)) {
                case 'collapse':
                    settle()
                    if (side) fold(side, true)
                    break
                case 'close':
                    settle()
                    close([action.id])
                    break
                case 'activate':
                case 'expand':
                case 'open':
                    show(action.id)
                    break
            }
            break
        }
        case 'show':
            show(action.id)
            break
        case 'close':
            settle()
            close([action.id])
            break
        case 'toggleDock': {
            const dock = layoutOf(next).docks[action.side]
            if (!dock) break
            if (!dock.collapsed) {
                fold(action.side, true)
                break
            }
            fold(action.side, false)
            // A side held back for the other side takes the room by becoming
            // the most recent.
            const recent = next.recency.find((id) => dock.open.includes(id))
            if (recent) next = { ...next, recency: touchRecency(next.recency, recent) }
            break
        }
    }
    return next
}

/**
 * Carries what is shown across a change of shape, such as rotating a tablet,
 * that moves Auto panels between docks. Each dock that receives panels is
 * folded when none of its panels were shown, and otherwise opens, closing the
 * panels that were folded away, so rotating never reveals or hides a panel.
 */
export const carryAcrossShape = (
    previous: WorkspaceLayout,
    next: WorkspaceLayout,
    state: WorkspaceToggleState,
): WorkspaceToggleState => {
    const wasShown = (id: PanelId) => {
        const side = previous.sides[id]
        return !!side && !!previous.docks[side]?.visible.includes(id)
    }
    const wasFolded = (id: PanelId) => {
        const side = previous.sides[id]
        return !!side && !!previous.docks[side]?.collapsed
    }
    let result = state
    for (const dock of Object.values(next.docks)) {
        if (!dock.panels.some((id) => previous.sides[id] !== dock.side)) continue
        const shown = dock.open.filter(wasShown)
        const folded = dock.open.filter(wasFolded)
        if (shown.length) {
            result = {
                ...result,
                open: {
                    ...result.open,
                    ...Object.fromEntries(folded.map((id) => [id, false])),
                },
                collapsed: { ...result.collapsed, [dock.side]: false },
            }
        } else if (folded.length) {
            result = { ...result, collapsed: { ...result.collapsed, [dock.side]: true } }
        }
    }
    return result
}
