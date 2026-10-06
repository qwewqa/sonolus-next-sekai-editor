import { computed, ref, shallowRef, watch } from 'vue'
import { settings } from '../../settings'
import {
    carryAcrossShape,
    coarseRailSize,
    computeWorkspaceLayout,
    dockSides,
    panelIds,
    railSize,
    reduceWorkspace,
    tabAction,
    type DockSide,
    type PanelId,
    type PanelPosition,
    type WorkspaceAction,
    type WorkspaceToggleState,
} from './layout'

export type { DockSide, PanelId, PanelPosition } from './layout'

const positionKeys = {
    preview: 'previewPosition',
    groups: 'groupsPosition',
    stages: 'stagesPosition',
    properties: 'propertiesPosition',
} as const satisfies Record<PanelId, keyof typeof settings>

const openKeys = {
    preview: 'showPreview',
    groups: 'showGroups',
    stages: 'showStages',
    properties: 'showSidebar',
} as const satisfies Record<PanelId, keyof typeof settings>

const sizeKeys = {
    left: 'leftDockWidth',
    right: 'rightDockWidth',
    top: 'topDockHeight',
} as const satisfies Record<DockSide, keyof typeof settings>

const collapsedKeys = {
    left: 'leftDockCollapsed',
    right: 'rightDockCollapsed',
    top: 'topDockCollapsed',
} as const satisfies Record<DockSide, keyof typeof settings>

const coarseQuery = matchMedia('(pointer: coarse)')
/** Coarse pointers get larger rails and touch targets. */
export const isCoarsePointer = ref(coarseQuery.matches)
coarseQuery.addEventListener('change', () => {
    isCoarsePointer.value = coarseQuery.matches
})

/**
 * Sizes shown during a resize drag. They are saved only when the drag ends,
 * so a cancelled drag never touches the saved preference.
 */
export const dockSizeDrafts = shallowRef<Partial<Record<DockSide, number>>>({})
export const panelWeightsDraft = shallowRef<Partial<Record<PanelId, number>>>()

/** The workspace's layout viewport size, measured by the app shell. */
export const workspaceSize = shallowRef({
    width: document.documentElement.clientWidth,
    height: document.documentElement.clientHeight,
})

/**
 * The shape used to resolve Auto placement. The app shell holds it while a
 * text field inside a dock has focus, so an on-screen keyboard cannot move the
 * field being edited to another dock.
 */
export const autoShape = shallowRef(workspaceSize.value)

export const getPanelPosition = (id: PanelId): PanelPosition => settings[positionKeys[id]]

export const setPanelPosition = (id: PanelId, position: PanelPosition) => {
    settings[positionKeys[id]] = position
}

export const isPanelEnabled = (id: PanelId) => getPanelPosition(id) !== 'disabled'

export const isPanelOpen = (id: PanelId) => settings[openKeys[id]]

const panelOpenStates = computed(
    () =>
        Object.fromEntries(panelIds.map((id) => [id, isPanelOpen(id)])) as Record<PanelId, boolean>,
)

export const getDockSize = (side: DockSide) => settings[sizeKeys[side]]

export const setDockSize = (side: DockSide, size: number) => {
    settings[sizeKeys[side]] = Math.max(0, Math.round(size))
}

export const isDockCollapsed = (side: DockSide) => settings[collapsedKeys[side]]

export const setDockCollapsed = (side: DockSide, collapsed: boolean) => {
    settings[collapsedKeys[side]] = collapsed
}

const panelPositions = computed(
    () =>
        Object.fromEntries(panelIds.map((id) => [id, getPanelPosition(id)])) as Record<
            PanelId,
            PanelPosition
        >,
)

const toggleState = computed((): WorkspaceToggleState => ({
    open: panelOpenStates.value,
    recency: settings.panelRecency,
    collapsed: {
        left: settings.leftDockCollapsed,
        right: settings.rightDockCollapsed,
        top: settings.topDockCollapsed,
    },
}))

const layoutOf = (state: WorkspaceToggleState) =>
    computeWorkspaceLayout({
        ...workspaceSize.value,
        autoShape: autoShape.value,
        positions: panelPositions.value,
        ...state,
        sizes: {
            left: dockSizeDrafts.value.left ?? settings.leftDockWidth,
            right: dockSizeDrafts.value.right ?? settings.rightDockWidth,
            top: dockSizeDrafts.value.top ?? settings.topDockHeight,
        },
        weights: panelWeightsDraft.value ?? settings.panelWeights,
        previewAspectRatio: settings.previewAspectRatio,
        railSize: isCoarsePointer.value ? coarseRailSize : railSize,
        coarse: isCoarsePointer.value,
        previewOverlay: settings.previewTransportPosition === 'overlay',
    })

export const workspaceLayout = computed(() => layoutOf(toggleState.value))

/** Saves only what changed, so untouched settings are not rewritten. */
const commit = (state: WorkspaceToggleState) => {
    for (const id of panelIds)
        if (settings[openKeys[id]] !== state.open[id]) settings[openKeys[id]] = state.open[id]
    if (state.recency.join() !== settings.panelRecency.join())
        settings.panelRecency = [...state.recency]
    for (const side of dockSides)
        if (settings[collapsedKeys[side]] !== state.collapsed[side])
            settings[collapsedKeys[side]] = state.collapsed[side]
}

const apply = (action: WorkspaceAction) => {
    commit(reduceWorkspace(toggleState.value, action, layoutOf))
}

/**
 * Keeps exactly the same panels shown when rotating a tablet, or resizing
 * across a placement threshold, moves Auto panels between docks. The app shell
 * starts it once settings are loaded.
 */
export const keepPanelsAcrossShape = () =>
    watch(
        [workspaceLayout, panelPositions],
        ([layout, positions], [previous, previousPositions]) => {
            if (positions !== previousPositions) return
            if (panelIds.every((id) => layout.sides[id] === previous.sides[id])) return
            commit(carryAcrossShape(previous, layout, toggleState.value))
        },
        // Before rendering, against the layout last rendered: the size and the
        // shape for Auto update separately, and a layout between them was
        // never seen.
        { flush: 'pre' },
    )

export const getPanelSide = (id: PanelId) => workspaceLayout.value.sides[id]

/** The side dock currently open as a drawer over the editor, if any. */
export const drawerSide = computed(() =>
    (['left', 'right'] as const).find((side) => {
        const dock = workspaceLayout.value.docks[side]
        return dock?.overlay && dock.visible.length
    }),
)

/** Whether the panel's body is currently displayed (open and not covered). */
export const isPanelVisible = (id: PanelId) => {
    const side = getPanelSide(id)
    return !!side && !!workspaceLayout.value.docks[side]?.visible.includes(id)
}

export const setPanelWeights = (weights: Partial<Record<PanelId, number>>) => {
    settings.panelWeights = { ...settings.panelWeights, ...weights }
}

export const resetPanelWeights = (ids: PanelId[]) => {
    settings.panelWeights = Object.fromEntries(
        Object.entries(settings.panelWeights).filter(([id]) => !ids.includes(id as PanelId)),
    )
}

/**
 * Opens and reveals a panel, as commands do, without making any other panel
 * appear (see `reduceWorkspace`).
 */
export const showPanel = (id: PanelId) => {
    apply({ type: 'show', id })
}

/** Closes a panel without revealing another in its place. */
export const closePanel = (id: PanelId) => {
    apply({ type: 'close', id })
}

/** Docks a panel elsewhere and shows it there, leaving nothing revealed behind. */
export const movePanel = (id: PanelId, position: PanelPosition) => {
    // Panels its old dock was not showing would otherwise take its place.
    const side = getPanelSide(id)
    const covered = (side && workspaceLayout.value.docks[side]?.covered) ?? []
    for (const other of covered) if (other !== id) settings[openKeys[other]] = false
    setPanelPosition(id, position)
    showPanel(id)
}

/** Whether a click on the panel's name would hide it. */
export const isTabHiding = (id: PanelId) => {
    const action = tabAction(workspaceLayout.value, panelOpenStates.value, id)
    return action === 'close' || action === 'collapse'
}

/** A click on a panel's name hides it if visible and otherwise shows it. */
export const onPanelTab = (id: PanelId) => {
    apply({ type: 'tab', id })
}

/** Folds a dock away, or restores exactly the panels it showed. */
export const toggleDockCollapsed = (side: DockSide) => {
    apply({ type: 'toggleDock', side })
}

/** Marks dock elements so editor shortcuts ignore keys typed inside them. */
export const workspaceDockAttribute = 'data-workspace-dock'

export const isInWorkspaceDock = (element: Element | null) =>
    !!element?.closest(`[${workspaceDockAttribute}]`)

/** Marks chrome outside docks whose controls take keys as dock controls do. */
export const dockKeysAttribute = 'data-dock-keys'

export const takesDockKeys = (element: Element | null) =>
    !!element?.closest(`[${workspaceDockAttribute}], [${dockKeysAttribute}]`)
