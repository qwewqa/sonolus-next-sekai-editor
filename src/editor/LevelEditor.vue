<script setup lang="ts">
import { computed, useTemplateRef, watch, type Ref } from 'vue'
import { useAutoSave } from '../history/autoSave'
import { isDynamicStages } from '../history/dynamicStages.ts'
import { groups } from '../history/groups'
import { stages } from '../history/stages'
import { i18n } from '../i18n'
import { screenSm } from '../screen'
import { settings } from '../settings'
import { interpolateRaw } from '../utils/interpolate'
import LevelEditorCanvas from './canvas/LevelEditorCanvas.vue'
import { useControlLifecycle } from './controls'
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
        <div
            ref="container"
            class="relative flex-grow select-none overflow-hidden"
            tabindex="-1"
            @pointerdown="container?.focus()"
        >
            <template v-if="view.w && view.h">
                <LevelEditorRangeMarkers />
                <LevelEditorHoverMarkers />

                <LevelEditorNotification />

                <LevelEditorCanvas />
            </template>

            <LevelEditorToolbar />
        </div>
        <div class="z-10 flex gap-4 bg-preview px-2 py-1 text-xs text-white/50">
            <span class="flex-grow">{{ tool.title() }}</span>
            <span v-if="isDynamicStages">{{ stage }}</span>
            <span>{{ group }}</span>
            <span>1/{{ view.division }}</span>
        </div>
    </div>
</template>
