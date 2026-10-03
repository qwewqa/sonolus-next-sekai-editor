import { onUnmounted, watch } from 'vue'
import { isAppActive } from '../../activity'
import { state } from '../../history'
import { hasSameChartData } from '../../state/data'
import { editorNavigation, type EditorNavigation } from '../navigation'
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
