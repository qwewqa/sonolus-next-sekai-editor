<script setup lang="ts">
import { useTemplateRef, watch } from 'vue'
import { contextMenu } from './editor/contextMenu'
import LevelEditor from './editor/LevelEditor.vue'
import {
    autoShape,
    drawerSide,
    isInWorkspaceDock,
    keepDefaultsAcrossDisplay,
    keepPanelsAcrossShape,
    measureRootFontSize,
    setDockCollapsed,
    workspaceSize,
} from './editor/workspace'
import WorkspaceDock from './editor/workspace/WorkspaceDock.vue'
import { languageTag } from './i18n/plural'
import { modals } from './modals'
import ModalManager from './modals/ModalManager.vue'
import { settings } from './settings'

watch(
    () => settings.locale,
    () => {
        document.documentElement.lang = languageTag(settings.locale)
    },
    { immediate: true },
)

const root = useTemplateRef<HTMLDivElement>('root')

keepPanelsAcrossShape()
keepDefaultsAcrossDisplay()

// Text entry inside a dock may open an on-screen keyboard. Hold the shape used
// for Auto placement until editing ends so the field stays where it is.
const isEditingText = () => {
    const element = document.activeElement
    return (
        isInWorkspaceDock(element) &&
        (element instanceof HTMLTextAreaElement ||
            (element instanceof HTMLInputElement &&
                !['button', 'checkbox', 'radio', 'range', 'color', 'file'].includes(element.type)))
    )
}

const isEditable = (element: Element | null) =>
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement ||
    (element instanceof HTMLInputElement &&
        !['button', 'checkbox', 'radio', 'range', 'color', 'file'].includes(element.type)) ||
    (element instanceof HTMLElement && element.isContentEditable)

// Escape closes an open drawer, like the other transient surfaces, before it
// can reach editor shortcuts. Fields and menus keep their own Escape.
const onKeydown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !drawerSide.value || modals.length || contextMenu.value) return
    const target = event.target instanceof Element ? event.target : null
    if (isEditable(target) || target?.closest('[role="menu"]')) return
    // A resize or row drag in the drawer cancels on Escape itself.
    if (document.querySelector('.resize-handle.is-dragging, .manager-row-dragging')) return
    // A selecting manager list stops selecting on Escape instead.
    if (target?.closest('.manager-list-selecting')) return
    setDockCollapsed(drawerSide.value, true)
    event.preventDefault()
    event.stopPropagation()
}

// Panel chrome never shows the browser's own context menu; text fields keep
// theirs for copy and paste.
const onContextMenu = (event: MouseEvent) => {
    const target = event.target instanceof Element ? event.target : null
    if (isInWorkspaceDock(target) && !isEditable(target)) event.preventDefault()
}

const updateShape = () => {
    if (!isEditingText()) autoShape.value = workspaceSize.value
}

watch(root, (element, _, onCleanup) => {
    if (!element) return

    // The root fills the layout viewport, so a visual-viewport-only change such
    // as an on-screen keyboard does not rearrange the workspace. Measuring on
    // window resize, before observers run, lets panels observe the new layout
    // in the same frame without ResizeObserver loop errors.
    const measure = () => {
        measureRootFontSize()
        const { width, height } = element.getBoundingClientRect()
        if (width === workspaceSize.value.width && height === workspaceSize.value.height) return
        workspaceSize.value = { width, height }
        updateShape()
    }
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('keydown', onKeydown, true)
    element.addEventListener('contextmenu', onContextMenu)

    const onFocusOut = () => {
        setTimeout(updateShape, 0)
    }
    element.addEventListener('focusout', onFocusOut)

    onCleanup(() => {
        window.removeEventListener('resize', measure)
        window.removeEventListener('keydown', onKeydown, true)
        element.removeEventListener('contextmenu', onContextMenu)
        element.removeEventListener('focusout', onFocusOut)
    })
})
</script>

<template>
    <div ref="root" class="flex h-screen w-screen overflow-hidden">
        <WorkspaceDock side="left" />
        <div class="relative flex min-w-0 flex-1 flex-col">
            <WorkspaceDock side="top" />
            <LevelEditor class="min-h-0 flex-1" />
            <!-- While a drawer covers the editor, a tap beside it only closes it. -->
            <div
                v-if="drawerSide"
                class="absolute inset-0 z-[35] touch-none bg-black/30"
                aria-hidden="true"
                @pointerdown.prevent.stop="drawerSide && setDockCollapsed(drawerSide, true)"
            />
        </div>
        <WorkspaceDock side="right" />
    </div>

    <ModalManager />
</template>
