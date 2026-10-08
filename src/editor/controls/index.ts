import { computed, onUnmounted, ref, watch } from 'vue'
import { isAppActive } from '../../activity'
import { replaceState, state } from '../../history'
import { isBlockingModalOpen } from '../../modals'
import { hasSameChartData } from '../../state/data'
import type { EntityType } from '../../state/entities'
import { cancelScalingSession, scalingSession } from '../commands/scaleSelection/session'
import { editorNavigation, type EditorNavigation } from '../navigation'
import { isEntityShown, scopeLookup } from '../scope'
import { isScopeReduced } from '../scopeRules'
import { tool } from '../tools'
import { view } from '../view'
import { dragCursor, lockedCursor } from './cursor'
import { isDragging } from './gestures/recognizers/drag'
import { cancelMouseControls, hasMouseControls, mouseControlListeners } from './mouse'
import { cancelTouchControls, hasTouchControls, touchControlListeners } from './touch'

export const activateEditorNavigation = (navigation?: EditorNavigation) => {
    if (hasMouseControls() || hasTouchControls()) return editorNavigation.value === navigation
    if (editorNavigation.value !== navigation) {
        view.scrollingX = undefined
        view.scrollingY = undefined
        view.entities = { hovered: [], creating: [] }
        editorNavigation.value = navigation
    }
    return true
}

const cancelControls = (restoreTool = true) => {
    cancelMouseControls(restoreTool)
    cancelTouchControls()
    view.selection = undefined
    view.entities = { hovered: [], creating: [] }
}

// Open toolbar flyouts' Escape handlers, run after a drag's and before any pane's or drawer's.
export const flyoutEscapes = new Set<(event: KeyboardEvent) => void>()

// Only a fresh Escape press cancels a drag; a held Escape's repeats do nothing.
let swallowsEscape = false
const cancelDragOnEscape = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || event.isComposing) return
    if (!isDragging.value && !(swallowsEscape && event.repeat)) {
        swallowsEscape = false
        for (const close of flyoutEscapes) close(event)
        return
    }
    event.preventDefault()
    event.stopImmediatePropagation()
    swallowsEscape = true
    if (!event.repeat) cancelControls()
}
const releaseEscape = (event: KeyboardEvent) => {
    if (event.key === 'Escape') swallowsEscape = false
}
// Registered at load, so it runs before every other Escape handler.
addEventListener('keydown', cancelDragOnEscape, true)
addEventListener('keyup', releaseEscape, true)
if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        removeEventListener('keydown', cancelDragOnEscape, true)
        removeEventListener('keyup', releaseEscape, true)
    })
}

// Hidden objects, by type, group or stage, must not stay selected: keyboard
// commands, properties and scaling act on the selection. Dimmed objects stay
// selected (for example after moving notes to an unfocused group). This only
// replaces the selection of the current history entry; it never changes chart
// data or adds an undo entry.
const deselectHidden = () => {
    const current = state.value
    const selected = current.selectedEntities
    if (selected.every(isEntityShown)) return
    replaceState({ ...current, selectedEntities: selected.filter(isEntityShown) })
}

export const useControlLifecycle = () => {
    watch(
        [tool, state],
        ([currentTool, currentState], [previousTool, previousState]) => {
            if (
                currentTool === previousTool &&
                hasSameChartData(currentState, previousState) &&
                currentState.bgm === previousState.bgm &&
                currentState.initialLife === previousState.initialLife
            ) {
                return
            }
            // Selection changes are part of dragging. Tool switches, undo,
            // reset and other chart changes invalidate the gesture's objects.
            cancelControls(currentTool === previousTool)
        },
        { flush: 'sync' },
    )
    watch(
        scopeLookup,
        (next, previous) => {
            // Changing the focus or hiding groups or stages can hide the
            // objects of an active drag, resize, placement or scaling session.
            // Cancel rather than commit an edit the user cannot see. Pure
            // reveals, including authoring revealing its own target, cannot.
            if (!isScopeReduced(previous, next)) return
            cancelControls()
            if (scalingSession.value) cancelScalingSession()
            deselectHidden()
        },
        { flush: 'sync' },
    )
    watch(
        () => view.visibilities,
        (next, previous) => {
            // Hiding a type hides its objects the same way.
            const types = Object.keys(next) as EntityType[]
            if (!types.some((type) => previous[type] && !next[type])) return
            cancelControls()
            if (scalingSession.value) cancelScalingSession()
            deselectHidden()
        },
        { flush: 'sync' },
    )
    // Undo/redo and loading can restore a selection that includes hidden objects.
    watch(state, deselectHidden, { flush: 'sync' })
    watch(
        isAppActive,
        (active) => {
            if (!active) cancelControls()
        },
        { flush: 'sync' },
    )
    // A dialog that holds the editor cancels a press or drag, as blur does.
    watch(
        isBlockingModalOpen,
        (open) => {
            if (open) cancelControls()
        },
        { flush: 'sync' },
    )
    onUnmounted(cancelControls)
}

const contextmenu = (event: Event) => {
    event.preventDefault()
}

export const controlListeners = {
    ...mouseControlListeners,
    ...touchControlListeners,
    contextmenu,
}

export const controlsForNavigation = (getNavigation: () => EditorNavigation | undefined) =>
    Object.fromEntries(
        Object.entries(controlListeners).map(([name, listener]) => [
            name,
            (event: Event) => {
                if (activateEditorNavigation(getNavigation())) listener(event as never)
                else event.preventDefault()
            },
        ]),
    )

// Mouse only: touch and pen keep the inherited cursor.
export const useCanvasCursor = (getNavigation: () => EditorNavigation | undefined) => {
    const isMouse = ref(false)
    const cursor = computed(() => {
        if (!isMouse.value) return ''
        const locked = lockedCursor.value
        if (locked) return isDragging.value ? dragCursor(locked) : locked
        if (editorNavigation.value !== getNavigation()) return ''
        const { x, y } = view.pointer
        return tool.value.cursor?.(x, y) ?? 'default'
    })
    const track = (event: PointerEvent) => {
        isMouse.value = event.pointerType === 'mouse'
    }
    return {
        cursor,
        cursorListeners: {
            pointerover: track,
            pointermove: track,
            pointerdown: track,
            pointerleave: () => {
                isMouse.value = false
            },
        },
    }
}
