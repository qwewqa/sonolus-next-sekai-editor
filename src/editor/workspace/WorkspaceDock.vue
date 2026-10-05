<script setup lang="ts">
import { computed, type Component } from 'vue'
import { i18n } from '../../i18n'
import { settings } from '../../settings'
import { interpolateRaw } from '../../utils/interpolate'
import { clamp } from '../../utils/math'
import {
    dockSizeDrafts,
    drawerSide,
    panelWeightsDraft,
    resetPanelWeights,
    setDockSize,
    setPanelWeights,
    workspaceDockAttribute,
    workspaceLayout,
    type DockSide,
    type PanelId,
} from '.'
import { resizeTilePair, separatorSize, type DockTile } from './layout'
import PanelRail from './PanelRail.vue'
import { panelTileId, panelTitle } from './panels'
import GroupsPanel from './panels/GroupsPanel.vue'
import PreviewPanel from './panels/PreviewPanel.vue'
import PropertiesPanel from './panels/PropertiesPanel.vue'
import StagesPanel from './panels/StagesPanel.vue'
import ResizeHandle from './ResizeHandle.vue'

const props = defineProps<{
    side: DockSide
}>()

const components: Record<PanelId, Component> = {
    preview: PreviewPanel,
    groups: GroupsPanel,
    stages: StagesPanel,
    properties: PropertiesPanel,
}

const dock = computed(() => workspaceLayout.value.docks[props.side])
const row = computed(() => props.side === 'top')
const length = (size: number) => (row.value ? { width: `${size}px` } : { height: `${size}px` })
const thickness = (size: number) => (row.value ? { height: `${size}px` } : { width: `${size}px` })

// Outer dock resizing shows a draft size and saves it only when the drag ends,
// so display clamps never write back and a cancelled drag changes nothing.
let dockDrag: { base: number } | undefined
const direction = computed(() => (props.side === 'right' ? -1 : 1))

const clampDockSize = (size: number) =>
    dock.value ? clamp(size, dock.value.min, dock.value.max) : size
const setDockDraft = (size: number | undefined) => {
    const { [props.side]: _, ...rest } = dockSizeDrafts.value
    dockSizeDrafts.value = size === undefined ? rest : { ...rest, [props.side]: size }
}
const onDockStart = () => {
    dockDrag = { base: dock.value?.size ?? 0 }
}
const onDockMove = (delta: number) => {
    if (dockDrag) setDockDraft(clampDockSize(dockDrag.base + delta * direction.value))
}
const onDockEnd = () => {
    const draft = dockSizeDrafts.value[props.side]
    if (dockDrag && draft !== undefined) setDockSize(props.side, draft)
    dockDrag = undefined
    setDockDraft(undefined)
}
const onDockCancel = () => {
    dockDrag = undefined
    setDockDraft(undefined)
}
const setDisplayedDockSize = (size: number) => {
    setDockSize(props.side, clampDockSize(size))
}

// Resizing between adjacent tiles adjusts only that pair's relative weights.
let tileDrag: { a: DockTile; b: DockTile } | undefined
const pair = (index: number) => {
    const a = dock.value?.tiles[index]
    const b = dock.value?.tiles[index + 1]
    return a && b ? ([{ ...a }, { ...b }] as const) : undefined
}
const onTileStart = (index: number) => {
    const tiles = pair(index)
    if (tiles) tileDrag = { a: tiles[0], b: tiles[1] }
}
const onTileMove = (delta: number) => {
    if (!tileDrag) return
    panelWeightsDraft.value = {
        ...settings.panelWeights,
        ...resizeTilePair(tileDrag.a, tileDrag.b, tileDrag.a.size + delta),
    }
}
const onTileEnd = () => {
    if (tileDrag && panelWeightsDraft.value) settings.panelWeights = panelWeightsDraft.value
    tileDrag = undefined
    panelWeightsDraft.value = undefined
}
const onTileCancel = () => {
    tileDrag = undefined
    panelWeightsDraft.value = undefined
}
const onTileStep = (index: number, delta: number) => {
    const tiles = pair(index)
    if (tiles) setPanelWeights(resizeTilePair(tiles[0], tiles[1], tiles[0].size + delta))
}
const onTileReset = (index: number) => {
    const tiles = pair(index)
    if (tiles) resetPanelWeights([tiles[0].id, tiles[1].id])
}

// A drawer opens above the editor and the top dock.
const isDrawerOpen = computed(() => drawerSide.value === props.side)
</script>

<template>
    <div
        v-if="dock"
        :[workspaceDockAttribute]="side"
        class="workspace-dock relative flex shrink-0 select-none bg-preview"
        :class="{
            'z-30': !isDrawerOpen,
            'z-40': isDrawerOpen,
            'flex-col': side === 'top',
            'flex-row': side === 'left',
            'flex-row-reverse': side === 'right',
        }"
    >
        <PanelRail :side :dock />

        <div
            v-if="dock.visible.length"
            class="workspace-dock-body flex min-h-0 min-w-0 shrink-0"
            :class="[
                row ? 'flex-row' : 'flex-col',
                `workspace-dock-body-${side}`,
                dock.overlay
                    ? ['absolute inset-y-0', side === 'left' ? 'left-full' : 'right-full']
                    : 'relative',
            ]"
            :style="thickness(dock.size)"
        >
            <template v-for="(tile, index) in dock.tiles" :key="tile.id">
                <section
                    :id="panelTileId(tile.id)"
                    class="workspace-tile relative min-h-0 min-w-0 shrink-0"
                    :class="tile.id === 'preview' ? 'z-10' : 'overflow-hidden'"
                    :style="length(tile.size)"
                    :aria-label="panelTitle(tile.id)"
                >
                    <component :is="components[tile.id]" />
                </section>
                <!-- Tiles sit apart on the dock's chrome, like the rail beside
                them, so the handle between them takes the dock edge's mint states. -->
                <div
                    v-if="index < dock.tiles.length - 1"
                    class="relative z-20 shrink-0 bg-preview"
                    :style="length(separatorSize)"
                >
                    <ResizeHandle
                        :axis="row ? 'x' : 'y'"
                        :class="row ? 'left-1/2' : 'top-1/2'"
                        :label="
                            interpolateRaw(
                                i18n.workspace.resizeTiles,
                                panelTitle(tile.id),
                                panelTitle(dock.tiles[index + 1]?.id ?? tile.id),
                            )
                        "
                        :value="tile.size"
                        :min="tile.min"
                        :max="tile.size + (dock.tiles[index + 1]?.size ?? 0)"
                        @start="onTileStart(index)"
                        @move="onTileMove"
                        @end="onTileEnd"
                        @cancel="onTileCancel"
                        @step="onTileStep(index, $event)"
                        @set="onTileStep(index, $event - tile.size)"
                        @reset="onTileReset(index)"
                    />
                </div>
            </template>

            <div
                class="absolute"
                :class="{
                    'inset-y-0 right-0 w-0': side === 'left',
                    'inset-y-0 left-0 w-0': side === 'right',
                    'inset-x-0 bottom-0 h-0': side === 'top',
                }"
            >
                <ResizeHandle
                    :axis="row ? 'y' : 'x'"
                    :label="i18n.workspace.resize[side]"
                    :value="dock.size"
                    :min="dock.min"
                    :max="dock.max"
                    @start="onDockStart"
                    @move="onDockMove"
                    @end="onDockEnd"
                    @cancel="onDockCancel"
                    @step="setDisplayedDockSize(dock.size + $event * direction)"
                    @set="setDisplayedDockSize"
                    @reset="setDockSize(side, 0)"
                />
            </div>
        </div>
    </div>
</template>

<style scoped>
/* A soft edge where the dock meets the editor. */
.workspace-dock-body-left {
    box-shadow:
        1px 0 0 rgb(0 0 0 / 0.3),
        6px 0 12px -6px rgb(0 0 0 / 0.45);
}

.workspace-dock-body-right {
    box-shadow:
        -1px 0 0 rgb(0 0 0 / 0.3),
        -6px 0 12px -6px rgb(0 0 0 / 0.45);
}

.workspace-dock-body-top {
    box-shadow:
        0 1px 0 rgb(0 0 0 / 0.3),
        0 6px 12px -6px rgb(0 0 0 / 0.45);
}
</style>
