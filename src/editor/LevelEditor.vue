<script setup lang="ts">
import { computed, ref, useTemplateRef, watch, watchEffect, type Ref } from 'vue'
import { useAutoSave } from '../history/autoSave'
import { isDynamicStages } from '../history/dynamicStages.ts'
import { groups } from '../history/groups'
import { stages } from '../history/stages'
import { i18n } from '../i18n'
import { screenSm } from '../screen'
import { settings } from '../settings'
import { interpolateRaw } from '../utils/interpolate'
import LevelEditorCanvas from './canvas/LevelEditorCanvas.vue'
import ElevationEditor from './elevation/ElevationEditor.vue'
import { isElevationEditorOpen, isElevationSideBySide } from './elevation/state'
import LevelEditorContextMenu from './LevelEditorContextMenu.vue'
import { useControlLifecycle } from './controls'
import { cancelMouseControls } from './controls/mouse'
import { cancelTouchControls } from './controls/touch'
import { useFocusControl } from './controls/focus'
import { useKeyboardControl } from './controls/keyboard'
import LevelEditorHoverMarkers from './LevelEditorHoverMarkers.vue'
import LevelEditorNotification from './LevelEditorNotification.vue'
import LevelEditorRangeMarkers from './LevelEditorRangeMarkers.vue'
import LevelEditorToolbar from './toolbar/LevelEditorToolbar.vue'
import { tool } from './tools'
import { brushProperties } from './tools/brush'
import { view } from './view'

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
let resizing: { pointerId: number; original: number; left: number; width: number } | undefined
const setSplitWidth = (width: number) => {
    settings.elevationEditorWidth = Math.max(
        splitMinimum.value,
        Math.min(100 - splitMinimum.value, width),
    )
}
const startResize = (event: PointerEvent) => {
    if (event.button !== 0 || !host.value) return
    cancelMouseControls()
    cancelTouchControls()
    const rect = host.value.getBoundingClientRect()
    resizing = {
        pointerId: event.pointerId,
        original: settings.elevationEditorWidth,
        left: rect.left,
        width: rect.width,
    }
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}
const moveResize = (event: PointerEvent) => {
    if (event.pointerId !== resizing?.pointerId) return
    setSplitWidth((1 - (event.clientX - resizing.left) / resizing.width) * 100)
}
const finishResize = (event: PointerEvent) => {
    if (event.pointerId !== resizing?.pointerId) return
    if (event.type === 'pointercancel') settings.elevationEditorWidth = resizing.original
    resizing = undefined
}
const resizeKey = (event: KeyboardEvent) => {
    if (event.key === 'ArrowLeft') setSplitWidth(splitWidth.value + 2)
    else if (event.key === 'ArrowRight') setSplitWidth(splitWidth.value - 2)
    else if (event.key === 'Escape' && resizing) {
        settings.elevationEditorWidth = resizing.original
        resizing = undefined
    } else if (event.key === 'Home') setSplitWidth(splitMinimum.value)
    else if (event.key === 'End') setSplitWidth(100 - splitMinimum.value)
    else return
    event.preventDefault()
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
watch(
    [
        screenSm,
        () => settings.previewPosition,
        () => settings.showPreview,
        () => settings.previewWidth,
        () => settings.previewHeight,
        () => settings.showSidebar,
        () => settings.sidebarWidth,
    ],
    updateBounds,
    { flush: 'post' },
)

watch([groups, () => view.groupId], () => {
    if (!view.groupId) return
    if (groups.value.has(view.groupId)) return

    view.groupId = undefined
})

watch([groups, () => brushProperties.value.groupId], () => {
    if (!brushProperties.value.groupId) return
    if (groups.value.has(brushProperties.value.groupId)) return

    brushProperties.value.groupId = undefined
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

const group = computed(() =>
    view.groupId === undefined
        ? i18n.value.statusBar.group.all
        : interpolateRaw(
              i18n.value.statusBar.group.one,
              groups.value.get(view.groupId)?.name ?? '',
          ),
)

const stage = computed(() =>
    view.stageId === undefined
        ? i18n.value.statusBar.stage.all
        : interpolateRaw(
              i18n.value.statusBar.stage.one,
              stages.value.get(view.stageId)?.name ?? '',
          ),
)
</script>

<template>
    <div class="flex flex-col">
        <div ref="host" class="relative flex min-h-0 flex-grow select-none overflow-hidden">
            <div
                v-if="!isElevationEditorOpen || isElevationSideBySide"
                ref="container"
                class="relative min-w-0 flex-1 overflow-hidden"
                tabindex="-1"
                @pointerdown="container?.focus()"
            >
                <template v-if="view.w && view.h">
                    <LevelEditorRangeMarkers />
                    <LevelEditorHoverMarkers />
                    <LevelEditorCanvas />
                </template>
                <LevelEditorToolbar />
            </div>
            <div
                v-if="isElevationEditorOpen && isElevationSideBySide"
                class="relative z-10 w-px flex-none bg-white/10"
            >
                <div
                    class="absolute inset-y-0 -left-1.5 w-3 cursor-col-resize touch-none hover:bg-white/10 focus:bg-white/10 focus:outline-none"
                    role="separator"
                    tabindex="0"
                    aria-orientation="vertical"
                    :aria-label="i18n.elevation.resize"
                    :title="i18n.elevation.resize"
                    :aria-valuemin="splitMinimum"
                    :aria-valuemax="100 - splitMinimum"
                    :aria-valuenow="Math.round(splitWidth)"
                    @pointerdown.stop.prevent="startResize"
                    @pointermove.stop="moveResize"
                    @pointerup.stop="finishResize"
                    @pointercancel.stop="finishResize"
                    @lostpointercapture="finishResize"
                    @keydown.stop="resizeKey"
                    @dblclick="settings.elevationEditorWidth = 50"
                />
            </div>
            <div
                v-if="isElevationEditorOpen"
                class="relative min-w-0 flex-1 overflow-hidden"
                :style="isElevationSideBySide ? { flex: `0 0 ${splitWidth}%` } : undefined"
            >
                <ElevationEditor />
            </div>
            <LevelEditorNotification />
            <LevelEditorContextMenu />
        </div>
        <div class="z-10 flex gap-4 bg-preview px-2 py-1 text-xs text-white/50">
            <span class="flex-grow">{{ tool.title() }}</span>
            <span v-if="isDynamicStages">{{ stage }}</span>
            <span>{{ group }}</span>
            <span>1/{{ view.division }}</span>
        </div>
    </div>
</template>
