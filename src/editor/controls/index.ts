import { onUnmounted, watch } from 'vue'
import { isAppActive } from '../../activity'
import { replaceState, state } from '../../history'
import { hasSameChartData } from '../../state/data'
import type { Entity } from '../../state/entities'
import { cancelScalingSession, scalingSession } from '../commands/scaleSelection/session'
import { editorNavigation, type EditorNavigation } from '../navigation'
import { scopeLookup } from '../scope'
import { entityScopeVisibility, isScopeReduced } from '../scopeRules'
import { tool } from '../tools'
import { view } from '../view'
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

const isShown = (entity: Entity) => entityScopeVisibility(entity, scopeLookup.value) !== 'hidden'

// Hidden objects must not stay selected: keyboard commands, properties and
// scaling act on the selection. Dimmed objects stay selected (for example after
// moving notes to an unfocused group). This only replaces the selection of the
// current history entry; it never changes chart data or adds an undo entry.
const deselectHidden = () => {
    const current = state.value
    const selected = current.selectedEntities
    if (selected.every(isShown)) return
    replaceState({ ...current, selectedEntities: selected.filter(isShown) })
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
    // Undo/redo and loading can restore a selection that includes hidden objects.
    watch(state, deselectHidden, { flush: 'sync' })
    watch(
        isAppActive,
        (active) => {
            if (!active) cancelControls()
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
