<script setup lang="ts">
import { computed, ref, useTemplateRef, watch, watchEffect, type Ref } from 'vue'
import { useAutoSave } from '../history/autoSave'
import { isDynamicStages } from '../history/dynamicStages.ts'
import { folderPathParts, templateParts, type NamePart } from '../chart/folders'
import { groupFolders, groups } from '../history/groups'
import { stageFolders, stages } from '../history/stages'
import { i18n } from '../i18n'
import { settings } from '../settings'
import { interpolateRaw } from '../utils/interpolate'
import LevelEditorCanvas from './canvas/LevelEditorCanvas.vue'
import ElevationEditor from './elevation/ElevationEditor.vue'
import { isElevationEditorOpen, isElevationSideBySide } from './elevation/state'
import LevelEditorContextMenu from './LevelEditorContextMenu.vue'
import { activateEditorNavigation, useControlLifecycle } from './controls'
import { useFocusControl } from './controls/focus'
import { useKeyboardControl } from './controls/keyboard'
import LevelEditorHoverMarkers from './LevelEditorHoverMarkers.vue'
import LevelEditorNotification from './LevelEditorNotification.vue'
import LevelEditorRangeMarkers from './LevelEditorRangeMarkers.vue'
import { groupScope, stageScope } from './scope'
import LevelEditorToolbar from './toolbar/LevelEditorToolbar.vue'
import EditorToolModalHost from './EditorToolModalHost.vue'
import { hasToolModal } from './toolModals'
import { switchToolTo, tool, toolName, type ToolName } from './tools'
import { brushProperties } from './tools/brush'
import { view } from './view'
import { manageGroups } from './commands/manageGroups'
import { manageStages } from './commands/manageStages'
import type { Command } from './commands'
import { workspaceLayout } from './workspace'
import ResizeHandle from './workspace/ResizeHandle.vue'

useFocusControl()
useKeyboardControl()
useControlLifecycle()

useAutoSave()

const container: Ref<HTMLDivElement | null> = useTemplateRef('container')
const host = useTemplateRef<HTMLDivElement>('host')
const hostWidth = ref(0)
watch(host, (element, _, cleanup) => {
    if (!element) return
    const update = () => {
        hostWidth.value = element.clientWidth
    }
    const observer = new ResizeObserver(update)
    observer.observe(element)
    update()
    cleanup(() => {
        observer.disconnect()
    })
})
watchEffect(() => {
    isElevationSideBySide.value =
        settings.elevationEditorSideBySide === 'allow' ||
        (settings.elevationEditorSideBySide === 'auto' && hostWidth.value >= 800)
})

const splitMinimum = computed(() =>
    Math.min(50, Math.max(20, (201 / Math.max(1, hostWidth.value)) * 100)),
)
const splitWidth = computed(() =>
    Math.max(splitMinimum.value, Math.min(100 - splitMinimum.value, settings.elevationEditorWidth)),
)
const setSplitWidth = (width: number) => {
    settings.elevationEditorWidth = Math.max(
        splitMinimum.value,
        Math.min(100 - splitMinimum.value, width),
    )
}
// The elevation pane is on the right, so moving the divider right (a positive
// pixel delta) narrows it. The setting is a percentage of the editor width.
const pixelsToPercent = (pixels: number) => (pixels / Math.max(1, hostWidth.value)) * 100
let resizing: { original: number; origin: number } | undefined
const onResizeStart = () => {
    resizing = { original: settings.elevationEditorWidth, origin: splitWidth.value }
}
const onResizeMove = (delta: number) => {
    if (resizing) setSplitWidth(resizing.origin - pixelsToPercent(delta))
}
const onResizeEnd = () => {
    resizing = undefined
}
const onResizeCancel = () => {
    if (resizing) settings.elevationEditorWidth = resizing.original
    resizing = undefined
}

const updateBounds = () => {
    if (!container.value) return

    const rect = container.value.getBoundingClientRect()
    view.x = rect.x
    view.y = rect.y
    view.w = rect.width
    view.h = rect.height
}

watch(container, (element, _, onCleanup) => {
    if (!element) return

    const observer = new ResizeObserver(updateBounds)
    observer.observe(element)
    updateBounds()

    window.addEventListener('resize', updateBounds)
    window.addEventListener('scroll', updateBounds, { capture: true, passive: true })
    window.visualViewport?.addEventListener('resize', updateBounds)
    window.visualViewport?.addEventListener('scroll', updateBounds)

    onCleanup(() => {
        observer.disconnect()
        window.removeEventListener('resize', updateBounds)
        window.removeEventListener('scroll', updateBounds, true)
        window.visualViewport?.removeEventListener('resize', updateBounds)
        window.visualViewport?.removeEventListener('scroll', updateBounds)
    })
})

// Panel layout changes can move the editor without changing its dimensions.
watch(workspaceLayout, updateBounds, { flush: 'post' })

watch([groups, () => view.groupId], () => {
    if (!view.groupId) return
    if (groups.value.has(view.groupId)) return

    view.groupId = undefined
})

// Visibility overrides are view state: drop entries for groups and stages that
// no longer exist after deletion, undo/redo, history replacement or loading a
// chart, and every stage entry while dynamic stages are disabled.
watch(
    groups,
    () => {
        groupScope.prune()
    },
    { immediate: true },
)
watch(
    [stages, isDynamicStages],
    () => {
        stageScope.prune()
    },
    { immediate: true },
)

// Synchronous, so no scope snapshot pairs a new show-other setting with stale overrides.
watch(
    () => settings.showOtherGroups,
    () => {
        groupScope.followSetting()
    },
    { flush: 'sync' },
)
watch(
    () => settings.showOtherStages,
    () => {
        stageScope.followSetting()
    },
    { flush: 'sync' },
)

watch([groups, () => brushProperties.value.groupId], () => {
    if (!brushProperties.value.groupId) return
    if (groups.value.has(brushProperties.value.groupId)) return

    brushProperties.value.groupId = undefined
})

// Event tools need dynamic stages, which undo can turn off; their events would not save.
const eventTools = new Set<ToolName>([
    'cameraEvent',
    'stageMaskEvent',
    'stagePivotEvent',
    'stageStyleEvent',
    'stageTransformEvent',
])
watch(isDynamicStages, (value) => {
    if (!value && eventTools.has(toolName.value)) switchToolTo('select')
})

watch([stages, isDynamicStages, () => view.stageId], () => {
    if (!view.stageId) return
    if (isDynamicStages.value && stages.value.has(view.stageId)) return

    view.stageId = undefined
})

watch([stages, isDynamicStages, () => brushProperties.value.stageId], () => {
    if (!brushProperties.value.stageId) return
    if (isDynamicStages.value && stages.value.has(brushProperties.value.stageId)) return

    brushProperties.value.stageId = undefined
})

const onStatusChip = (event: MouseEvent, command: Command) => {
    void command.execute()
    // Pointer clicks return keyboard shortcuts to the editor.
    if (event.detail > 0) (event.currentTarget as HTMLElement).blur()
}

// The target leads with its folder, e.g. "Verse › Lead Group", so it reads as
// inside it; the folder shortens before the name.
const group = computed((): NamePart[] =>
    view.groupId === undefined
        ? [{ text: i18n.value.statusBar.group.all, role: 'name' }]
        : templateParts(i18n.value.statusBar.group.one, [
              folderPathParts(
                  groups.value,
                  groupFolders.value,
                  view.groupId,
                  i18n.value.workspace.folders.path,
              ),
          ]),
)

const stage = computed((): NamePart[] =>
    view.stageId === undefined
        ? [{ text: i18n.value.statusBar.stage.all, role: 'name' }]
        : templateParts(i18n.value.statusBar.stage.one, [
              folderPathParts(
                  stages.value,
                  stageFolders.value,
                  view.stageId,
                  i18n.value.workspace.folders.path,
              ),
          ]),
)

/** How a run of a scope name shrinks: the folder first, then the name; text stays. */
const partClass = ({ text, role }: NamePart) =>
    role === 'folder'
        ? text.length > 2
            ? 'status-folder min-w-[2em] truncate'
            : 'shrink-0'
        : role === 'name'
          ? 'min-w-0 truncate'
          : 'shrink-0 whitespace-pre'

// Shown separately from the authoring target, and only while something is hidden.
const shownCount = (shown: number, total: number, message: string) => {
    if (shown >= total) return
    return {
        short: `${shown}/${total}`,
        label: interpolateRaw(message, `${shown}`, `${total}`),
    }
}
const groupCount = computed(() =>
    shownCount(
        groupScope.shownCount.value,
        groupScope.totalCount.value,
        i18n.value.statusBar.group.shown,
    ),
)
const stageCount = computed(() =>
    shownCount(
        stageScope.shownCount.value,
        stageScope.totalCount.value,
        i18n.value.statusBar.stage.shown,
    ),
)
</script>

<template>
    <!-- An own stacking context keeps editor overlays below docks and their popups. -->
    <div class="isolate flex flex-col">
        <div ref="host" class="relative flex min-h-0 flex-grow select-none overflow-hidden">
            <div
                v-if="!isElevationEditorOpen || isElevationSideBySide"
                ref="container"
                class="relative min-w-0 flex-1 overflow-hidden"
                tabindex="-1"
                @pointerenter="activateEditorNavigation()"
                @focusin="activateEditorNavigation()"
                @pointerdown="container?.focus()"
            >
                <template v-if="view.w && view.h">
                    <LevelEditorRangeMarkers />
                    <LevelEditorHoverMarkers />
                    <LevelEditorCanvas />
                </template>
                <LevelEditorNotification pane="main" />
                <LevelEditorToolbar v-if="!hasToolModal('main')" />
                <EditorToolModalHost pane="main" />
            </div>
            <div
                v-if="isElevationEditorOpen && isElevationSideBySide"
                class="relative z-10 w-px flex-none bg-white/10"
            >
                <ResizeHandle
                    axis="x"
                    :label="i18n.elevation.resize"
                    :value="splitWidth"
                    :min="splitMinimum"
                    :max="100 - splitMinimum"
                    @start="onResizeStart"
                    @move="onResizeMove"
                    @end="onResizeEnd"
                    @cancel="onResizeCancel"
                    @step="setSplitWidth(splitWidth - pixelsToPercent($event))"
                    @set="setSplitWidth"
                    @reset="settings.elevationEditorWidth = 50"
                />
            </div>
            <div
                v-if="isElevationEditorOpen"
                class="relative min-w-0 flex-1 overflow-hidden"
                :style="isElevationSideBySide ? { flex: `0 0 ${splitWidth}%` } : undefined"
            >
                <ElevationEditor />
            </div>
            <LevelEditorContextMenu />
        </div>
        <!-- Chrome: Meta text in white/80, 24px tall (32px on coarse pointers). -->
        <div
            class="z-10 flex gap-4 bg-preview px-2 py-1 text-xs text-white/80 [@media(pointer:coarse)]:py-2"
        >
            <span class="min-w-12 flex-grow truncate">{{ tool.title() }}</span>
            <!-- The scope chips open their managers. Long names truncate while the
            shown count stays visible. -->
            <button
                type="button"
                class="status-chip relative flex min-w-0 max-w-[40%] px-1"
                :title="i18n.commands.manageGroups.title"
                @click="onStatusChip($event, manageGroups)"
            >
                <span class="flex min-w-0">
                    <span v-for="(part, i) in group" :key="i" :class="partClass(part)">{{
                        part.text
                    }}</span>
                </span>
                <span
                    v-if="groupCount"
                    class="ml-1 shrink-0 whitespace-nowrap"
                    :title="groupCount.label"
                >
                    <span aria-hidden="true">· {{ groupCount.short }}</span>
                    <span class="sr-only">{{ groupCount.label }}</span>
                </span>
            </button>
            <button
                v-if="isDynamicStages"
                type="button"
                class="status-chip relative flex min-w-0 max-w-[40%] px-1"
                :title="i18n.commands.manageStages.title"
                @click="onStatusChip($event, manageStages)"
            >
                <span class="flex min-w-0">
                    <span v-for="(part, i) in stage" :key="i" :class="partClass(part)">{{
                        part.text
                    }}</span>
                </span>
                <span
                    v-if="stageCount"
                    class="ml-1 shrink-0 whitespace-nowrap"
                    :title="stageCount.label"
                >
                    <span aria-hidden="true">· {{ stageCount.short }}</span>
                    <span class="sr-only">{{ stageCount.label }}</span>
                </span>
            </button>
            <span class="shrink-0">1/{{ view.division }}</span>
        </div>
    </div>
</template>

<style scoped>
/* A long folder name gives way long before the target's own name. */
.status-folder {
    flex-shrink: 1000;
}

.status-chip {
    border-radius: 9999px;
    transition: color 150ms;
}

/* The hit area fills the bar's height (24px, or 32px on coarse pointers)
 * without making the chip or the bar taller. */
.status-chip::before {
    content: '';
    position: absolute;
    inset: -0.25rem;
}

@media (pointer: coarse) {
    .status-chip::before {
        inset-block: -0.5rem;
    }
}

.status-chip:active {
    color: theme('colors.white');
}

.status-chip:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px theme('colors.accent');
}

@media (hover: hover) {
    .status-chip:hover {
        color: theme('colors.white');
    }
}
</style>
