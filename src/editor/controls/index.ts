import { onUnmounted, watch } from 'vue'
import { isAppActive } from '../../activity'
import { state } from '../../history'
import { hasSamePreviewData } from '../../preview/edit'
import { tool } from '../tools'
import { view } from '../view'
import { cancelMouseControls, mouseControlListeners } from './mouse'
import { cancelTouchControls, touchControlListeners } from './touch'

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
                hasSamePreviewData(currentState, previousState) &&
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
