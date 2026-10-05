import assert from 'node:assert/strict'
import test from 'node:test'
import {
    carryAcrossShape,
    computeWorkspaceLayout,
    distribute,
    railSize,
    reduceWorkspace,
    resizeTilePair,
    resolveAutoSide,
    separatorSize,
    tabAction,
    touchRecency,
    type PanelId,
    type PanelPosition,
    type WorkspaceAction,
    type WorkspaceLayoutInput,
    type WorkspaceToggleState,
} from '../../src/editor/workspace/layout'

const input = (overrides: Partial<WorkspaceLayoutInput> = {}): WorkspaceLayoutInput => ({
    width: 1600,
    height: 1000,
    positions: { preview: 'auto', groups: 'auto', stages: 'auto', properties: 'auto' },
    open: { preview: true, groups: false, stages: false, properties: true },
    recency: ['preview', 'properties', 'groups', 'stages'],
    sizes: { left: 0, right: 0, top: 0 },
    weights: {},
    previewAspectRatio: 16 / 9,
    ...overrides,
})

const positions = (position: PanelPosition): Record<PanelId, PanelPosition> => ({
    preview: position,
    groups: position,
    stages: position,
    properties: position,
})

test('auto placement follows the workspace shape rather than width alone', () => {
    assert.equal(resolveAutoSide(1600, 1000, 'preview'), 'left')
    assert.equal(resolveAutoSide(1600, 1000, 'properties'), 'right')
    // Portrait tablets share a top dock even though they are wider than a phone.
    assert.equal(resolveAutoSide(820, 1180, 'properties'), 'top')
    assert.equal(resolveAutoSide(1024, 1366, 'groups'), 'top')
    // Medium landscape screens keep the editor wide with a single side dock.
    assert.equal(resolveAutoSide(844, 390, 'properties'), 'left')
    assert.equal(resolveAutoSide(390, 844, 'preview'), 'top')
})

test('desktop places managers with preview and properties on the right', () => {
    const layout = computeWorkspaceLayout(
        input({ open: { preview: true, groups: true, stages: true, properties: true } }),
    )
    assert.deepEqual(layout.docks.left?.panels, ['preview', 'groups', 'stages'])
    assert.deepEqual(layout.docks.left?.visible, ['preview', 'groups', 'stages'])
    assert.deepEqual(layout.docks.right?.visible, ['properties'])
    assert.equal(layout.docks.top, undefined)
    const tiles = layout.docks.left?.tiles ?? []
    const total = tiles.reduce((sum, tile) => sum + tile.size, 0)
    assert.ok(Math.abs(total + 2 * separatorSize - 1000) < 1e-6)
})

test('a dock keeps its rail when every panel is closed', () => {
    const layout = computeWorkspaceLayout(
        input({ open: { preview: false, groups: false, stages: false, properties: false } }),
    )
    assert.equal(layout.docks.left?.size, 0)
    assert.deepEqual(layout.docks.left?.panels, ['preview', 'groups', 'stages'])
    assert.deepEqual(layout.docks.left?.visible, [])
})

test('limited room shows the most recent open panels without closing the others', () => {
    const open = { preview: true, groups: true, stages: true, properties: true }
    const phone = computeWorkspaceLayout(
        input({
            width: 390,
            height: 844,
            open,
            recency: ['groups', 'preview', 'stages', 'properties'],
        }),
    )
    const top = phone.docks.top
    assert.ok(top)
    assert.deepEqual(top.open, ['preview', 'groups', 'stages', 'properties'])
    assert.deepEqual(top.visible, ['groups'])

    // Intermediate capacity: two of three open panels fit, in tab order.
    const short = computeWorkspaceLayout(
        input({
            height: 460,
            positions: positions('left'),
            open: { preview: true, groups: true, stages: true, properties: false },
            recency: ['stages', 'preview', 'groups', 'properties'],
        }),
    )
    assert.deepEqual(short.docks.left?.visible, ['preview', 'stages'])
    assert.equal(tabAction(short, open, 'groups'), 'activate')
    assert.equal(tabAction(short, open, 'stages'), 'close')
    assert.equal(tabAction(short, { ...open, properties: false }, 'properties'), 'open')
})

test('explicit positions override auto placement and disabled panels have no tab', () => {
    const layout = computeWorkspaceLayout(
        input({
            width: 390,
            height: 844,
            positions: { preview: 'right', groups: 'disabled', stages: 'top', properties: 'left' },
        }),
    )
    assert.deepEqual(layout.docks.right?.panels, ['preview'])
    assert.deepEqual(layout.docks.left?.panels, ['properties'])
    assert.deepEqual(layout.docks.top?.panels, ['stages'])
    assert.equal(layout.sides.groups, undefined)
})

test('dock sizes clamp for display without changing the saved preference', () => {
    const sizes = { left: 5000, right: 0, top: 0 }
    const layout = computeWorkspaceLayout(input({ width: 900, height: 600, sizes }))
    const left = layout.docks.left
    assert.ok(left)
    assert.ok(left.size <= left.max)
    // The editor keeps a usable width beside the dock and its rail.
    assert.ok(900 - railSize - left.size >= 320)
    assert.equal(sizes.left, 5000)

    const tiny = computeWorkspaceLayout(
        input({ width: 390, height: 844, sizes: { left: 0, right: 0, top: 10 } }),
    )
    assert.ok((tiny.docks.top?.size ?? 0) >= (tiny.docks.top?.min ?? Infinity))
})

test('opposite side docks share the room left beside the editor', () => {
    const layout = computeWorkspaceLayout(
        input({
            width: 1200,
            height: 800,
            positions: { preview: 'left', groups: 'left', stages: 'left', properties: 'right' },
            sizes: { left: 600, right: 600, top: 0 },
        }),
    )
    const left = layout.docks.left?.size ?? 0
    const right = layout.docks.right?.size ?? 0
    assert.ok(1200 - 2 * railSize - left - right >= 320)
    assert.ok(right >= 220)
})

test('weights distribute stack sizes and respect minimums', () => {
    assert.deepEqual(
        distribute(300, [
            { min: 0, weight: 1 },
            { min: 0, weight: 2 },
        ]),
        [100, 200],
    )
    assert.deepEqual(
        distribute(300, [
            { min: 150, weight: 1 },
            { min: 0, weight: 9 },
        ]),
        [150, 150],
    )
    const [a, b] = distribute(100, [
        { min: 100, weight: 1 },
        { min: 100, weight: 1 },
    ])
    assert.equal(a, 50)
    assert.equal(b, 50)
})

test('resizing a tile pair keeps their combined weight', () => {
    const weights = resizeTilePair(
        { id: 'groups', size: 200, min: 100, weight: 1 },
        { id: 'stages', size: 200, min: 100, weight: 1 },
        300,
    )
    assert.equal(weights.groups, 1.5)
    assert.equal(weights.stages, 0.5)
    const clamped = resizeTilePair(
        { id: 'groups', size: 200, min: 100, weight: 1 },
        { id: 'stages', size: 200, min: 100, weight: 1 },
        390,
    )
    assert.equal(clamped.groups, 1.5)
})

test('recency moves an activated panel to the front', () => {
    assert.deepEqual(touchRecency(['preview', 'properties', 'groups', 'stages'], 'groups'), [
        'groups',
        'preview',
        'properties',
        'stages',
    ])
})

test('hiding the only visible panel collapses its dock instead of revealing another', () => {
    const open = { preview: true, groups: false, stages: false, properties: true }
    const phone = (collapsed: boolean) =>
        computeWorkspaceLayout(
            input({ width: 390, height: 844, open, collapsed: { top: collapsed } }),
        )
    const expanded = phone(false)
    assert.deepEqual(expanded.docks.top?.visible, ['preview'])
    assert.deepEqual(expanded.docks.top?.covered, ['properties'])
    assert.equal(tabAction(expanded, open, 'preview'), 'collapse')
    assert.equal(tabAction(expanded, open, 'properties'), 'activate')

    const collapsed = phone(true)
    assert.deepEqual(collapsed.docks.top?.visible, [])
    assert.deepEqual(collapsed.docks.top?.open, ['preview', 'properties'])
    assert.equal(collapsed.docks.top?.size, 0)
    assert.equal(tabAction(collapsed, open, 'groups'), 'expand')
})

test('side docks too narrow to share the screen with the editor become drawers', () => {
    const layout = computeWorkspaceLayout(
        input({ width: 390, height: 844, positions: positions('right') }),
    )
    const right = layout.docks.right
    assert.ok(right)
    assert.equal(right.overlay, true)
    assert.ok(right.size >= 220)
    assert.equal(layout.docks.top, undefined)
})

test('a side dock grows only into room the other side is not using', () => {
    const base = input({
        width: 1600,
        height: 1000,
        positions: { preview: 'left', groups: 'left', stages: 'left', properties: 'right' },
    })
    const before = computeWorkspaceLayout(base)
    const max = before.docks.left?.max ?? 0
    const after = computeWorkspaceLayout({ ...base, sizes: { left: max, right: 0, top: 0 } })
    assert.equal(after.docks.right?.size, before.docks.right?.size)
    assert.equal(after.docks.left?.size, max)
})

test('hiding one side dock never resizes the other', () => {
    const base = input({
        positions: { preview: 'left', groups: 'left', stages: 'left', properties: 'right' },
    })
    const both = computeWorkspaceLayout(base)
    const leftOnly = computeWorkspaceLayout({ ...base, collapsed: { right: true } })
    const rightOnly = computeWorkspaceLayout({ ...base, collapsed: { left: true } })
    assert.equal(leftOnly.docks.left?.size, both.docks.left?.size)
    assert.equal(rightOnly.docks.right?.size, both.docks.right?.size)
})

test('collapsing the shown side does not reveal the other side in its place', () => {
    const base = input({
        width: 480,
        height: 800,
        positions: { preview: 'left', groups: 'left', stages: 'left', properties: 'right' },
        recency: ['preview', 'properties', 'groups', 'stages'],
    })
    const shown = computeWorkspaceLayout(base)
    assert.deepEqual(shown.docks.left?.visible, ['preview'])
    assert.deepEqual(shown.docks.right?.visible, [])
    const collapsed = computeWorkspaceLayout({ ...base, collapsed: { left: true } })
    assert.deepEqual(collapsed.docks.left?.visible, [])
    assert.deepEqual(collapsed.docks.right?.visible, [])
})

test('an unsized top dock fits the width Preview has, alone or in a row of tiles', () => {
    const tablet = (recency: PanelId[]) =>
        computeWorkspaceLayout(
            input({
                width: 820,
                height: 1180,
                coarse: true,
                open: { preview: true, groups: true, stages: false, properties: true },
                recency,
            }),
        ).docks.top
    // Tiled beside Groups and Properties, Preview is narrow: the dock stops at
    // the height that still docks its playback bar instead of leaving bands.
    const tiled = tablet(['preview', 'groups', 'properties', 'stages'])
    assert.deepEqual(tiled?.visible, ['preview', 'groups', 'properties'])
    const preview = tiled?.tiles.find(({ id }) => id === 'preview')
    assert.ok(preview && preview.size / (16 / 9) + 60 <= (tiled?.size ?? 0))
    assert.equal(tiled?.size, 300)
    // Alone in the dock, Preview spans it and the default height applies.
    const alone = computeWorkspaceLayout(
        input({
            width: 820,
            height: 1180,
            coarse: true,
            open: { ...input().open, properties: false },
        }),
    ).docks.top
    assert.equal(alone?.size, 420)
    // Switching the shown tab keeps the height.
    assert.equal(tablet(['groups', 'properties', 'preview', 'stages'])?.size, 300)
})

test('a stacked Preview fits its image, plus the playback strip unless it overlays', () => {
    const tile = (previewOverlay: boolean) =>
        computeWorkspaceLayout(
            input({
                positions: { ...positions('auto'), preview: 'left', groups: 'left' },
                open: { preview: true, groups: true, stages: false, properties: true },
                previewAspectRatio: 4 / 3,
                previewOverlay,
            }),
        ).docks.left?.tiles.find(({ id }) => id === 'preview')?.size
    assert.ok(Math.abs((tile(false) ?? 0) - (336 / (4 / 3) + 52)) < 1e-6)
    assert.ok(Math.abs((tile(true) ?? 0) - 336 / (4 / 3)) < 1e-6)
})

const visibleOf = (layout: ReturnType<typeof computeWorkspaceLayout>) =>
    Object.values(layout.docks).flatMap((dock) => dock.visible)

/** Plays actions on a screen, returning what is shown after each one. */
const play = (
    screen: Partial<WorkspaceLayoutInput>,
    state: WorkspaceToggleState,
    actions: WorkspaceAction[],
) => {
    const layoutOf = (state: WorkspaceToggleState) =>
        computeWorkspaceLayout(input({ ...screen, ...state }))
    const shown: PanelId[][] = []
    let current = state
    for (const action of actions) {
        current = reduceWorkspace(current, action, layoutOf)
        shown.push(visibleOf(layoutOf(current)))
    }
    return { shown, state: current }
}

const unfolded = { left: false, right: false, top: false }
const tabletPortrait = { width: 820, height: 1180, coarse: true, railSize: 44 }
const tabletLandscape = { width: 1180, height: 820, coarse: true, railSize: 44 }

test('hiding one of several shown panels never reveals one it covered', () => {
    // A portrait tablet's top dock fits three panels side by side.
    const { shown, state } = play(
        tabletPortrait,
        {
            open: { preview: true, groups: true, stages: false, properties: false },
            recency: ['preview', 'groups', 'stages', 'properties'],
            collapsed: unfolded,
        },
        [
            { type: 'tab', id: 'stages' },
            { type: 'tab', id: 'properties' },
            { type: 'tab', id: 'properties' },
        ],
    )
    assert.deepEqual(shown, [
        ['preview', 'groups', 'stages'],
        // Groups, the least recent, makes room and is closed, not covered.
        ['preview', 'stages', 'properties'],
        ['preview', 'stages'],
    ])
    assert.equal(state.open.groups, false)
})

test('closing a panel by key or menu never reveals a covered one either', () => {
    // A phone's top dock fits one panel; Properties starts covered by Preview.
    const { shown, state } = play(
        { width: 390, height: 844, coarse: true, railSize: 44 },
        {
            open: { preview: true, groups: false, stages: false, properties: true },
            recency: ['preview', 'properties', 'groups', 'stages'],
            collapsed: unfolded,
        },
        [{ type: 'close', id: 'preview' }],
    )
    assert.deepEqual(shown, [[]])
    assert.equal(state.open.properties, false)
})

test('a tab or command on a folded dock shows just that panel', () => {
    const actions: WorkspaceAction[] = [
        { type: 'tab', id: 'groups' },
        { type: 'show', id: 'groups' },
    ]
    for (const action of actions) {
        const { shown } = play(
            tabletLandscape,
            {
                open: { preview: true, groups: false, stages: true, properties: true },
                recency: ['preview', 'stages', 'properties', 'groups'],
                collapsed: { left: true, right: false, top: false },
            },
            [action, { type: 'toggleDock', side: 'left' }, { type: 'toggleDock', side: 'left' }],
        )
        assert.deepEqual(shown, [
            ['groups', 'properties'],
            // The chevron folds and restores exactly what was shown.
            ['properties'],
            ['groups', 'properties'],
        ])
    }
})

test('the chevron restores every panel a dock showed when folded', () => {
    const { shown } = play(
        tabletPortrait,
        {
            open: { preview: true, groups: true, stages: false, properties: false },
            recency: ['preview', 'groups', 'stages', 'properties'],
            collapsed: unfolded,
        },
        [
            { type: 'toggleDock', side: 'top' },
            { type: 'toggleDock', side: 'top' },
        ],
    )
    assert.deepEqual(shown, [[], ['preview', 'groups']])
})

test('a tab on another panel after folding by tab shows only that panel', () => {
    const { shown, state } = play(
        tabletPortrait,
        {
            open: { preview: true, groups: false, stages: false, properties: false },
            recency: ['preview', 'groups', 'stages', 'properties'],
            collapsed: unfolded,
        },
        [
            { type: 'tab', id: 'preview' },
            { type: 'tab', id: 'groups' },
        ],
    )
    assert.deepEqual(shown, [[], ['groups']])
    assert.equal(state.open.preview, false)
})

test('a side dock held back for the other side never returns on its own', () => {
    // Too narrow for both sides: showing one side closes the other's panels.
    const screen: Partial<WorkspaceLayoutInput> = {
        ...tabletPortrait,
        positions: { preview: 'top', groups: 'left', stages: 'top', properties: 'right' },
    }
    const { shown, state } = play(
        screen,
        {
            open: { preview: false, groups: true, stages: false, properties: false },
            recency: ['groups', 'preview', 'stages', 'properties'],
            collapsed: unfolded,
        },
        [
            { type: 'tab', id: 'properties' },
            { type: 'tab', id: 'properties' },
            { type: 'close', id: 'properties' },
        ],
    )
    assert.deepEqual(shown, [['properties'], [], []])
    assert.equal(state.open.groups, false)
})

test('rotating a tablet keeps exactly the same panels shown', () => {
    const layoutIn = (screen: Partial<WorkspaceLayoutInput>, state: WorkspaceToggleState) =>
        computeWorkspaceLayout(input({ ...screen, ...state }))
    const rotate = (
        state: WorkspaceToggleState,
        from: Partial<WorkspaceLayoutInput>,
        to: Partial<WorkspaceLayoutInput>,
    ) => carryAcrossShape(layoutIn(from, state), layoutIn(to, state), state)

    // Folded in portrait, Preview and Properties stay hidden in landscape,
    // where they land in two different docks, and the chevrons restore them.
    const folded: WorkspaceToggleState = {
        open: { preview: true, groups: false, stages: false, properties: true },
        recency: ['preview', 'properties', 'groups', 'stages'],
        collapsed: { left: false, right: false, top: true },
    }
    const turned = rotate(folded, tabletPortrait, tabletLandscape)
    assert.deepEqual(visibleOf(layoutIn(tabletLandscape, turned)), [])
    assert.deepEqual(turned.collapsed, { left: true, right: true, top: true })
    assert.deepEqual(turned.open, folded.open)
    assert.equal(rotate(turned, tabletLandscape, tabletPortrait).collapsed.top, true)

    // Folded on the left in landscape while Properties shows on the right:
    // portrait's shared top dock shows Properties alone.
    const mixed: WorkspaceToggleState = {
        open: { preview: true, groups: true, stages: true, properties: true },
        recency: ['properties', 'preview', 'groups', 'stages'],
        collapsed: { left: true, right: false, top: false },
    }
    const back = rotate(mixed, tabletLandscape, tabletPortrait)
    assert.deepEqual(visibleOf(layoutIn(tabletPortrait, back)), ['properties'])
    assert.equal(back.collapsed.top, false)
})
