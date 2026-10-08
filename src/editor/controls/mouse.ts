import { watch } from 'vue'
import { settings } from '../../settings'
import { clamp } from '../../utils/math'
import { beginAudioPreviewInteraction } from '../audioPreview'
import { zoomXIn } from '../commands/zooms/zoomXIn'
import { zoomXOut } from '../commands/zooms/zoomXOut'
import { zoomYIn } from '../commands/zooms/zoomYIn'
import { zoomYOut } from '../commands/zooms/zoomYOut'
import { closeContextMenu, openContextMenu } from '../contextMenu'
import { editorNavigation, getControlBounds } from '../navigation'
import { cancelPreviewFollow, stopPlayer } from '../player'
import { switchToolTo, tool, toolName, type ToolName } from '../tools'
import {
    scrollViewXBy,
    scrollViewYBy,
    setViewHover,
    updateViewPointer,
    view,
    viewBox,
} from '../view'
import { lockCursor, unlockCursor } from './cursor'
import { gesture } from './gestures/gesture'
import { drag, isDragging } from './gestures/recognizers/drag'
import { tap } from './gestures/recognizers/tap'
import { clearPageSelection } from './pageSelection'

const mouseGesture = gesture(drag(false), tap(Infinity))

export const hasMouseControls = () => mouseGesture.pointerCount > 0

// The pane a press started in; the press follows the mouse outside it until release.
let pressedPane: Element | undefined
// The event the window listeners already handled for the press.
let tracked: Event | undefined
const isTracked = (event: Event) => event === tracked && event.currentTarget !== window

const toP = (event: MouseEvent) => {
    // Outside its pane, a press stays at the pane's edge.
    const rect = pressedPane?.getBoundingClientRect()
    return {
        id: 1,
        x: rect ? clamp(event.clientX, rect.left, rect.right) : event.clientX,
        y: rect ? clamp(event.clientY, rect.top, rect.bottom) : event.clientY,
        modifiers: {
            // Cmd plays Ctrl's part on Apple platforms, where Ctrl+click is a right click.
            ctrl: event.ctrlKey || event.metaKey,
            shift: event.shiftKey,
        },
    }
}

const trackMove = (event: MouseEvent) => {
    tracked = event
    // A release the page never saw ends the press.
    if (event.buttons) mousemove(event)
    else mouseup(event)
}
const trackUp = (event: MouseEvent) => {
    tracked = event
    mouseup(event)
}
const stopTracking = () => {
    if (!pressedPane) return
    pressedPane = undefined
    removeEventListener('mousemove', trackMove, true)
    removeEventListener('mouseup', trackUp, true)
}

let secondarySwitchBack: ToolName | undefined
let switchingSecondaryTool = false
let contextClick: { x: number; y: number } | undefined
// The mouse rests over the chart, unpressed.
let isHovering = false

export const cancelMouseControls = (restoreTool = true) => {
    if (switchingSecondaryTool) return
    contextClick = undefined
    closeContextMenu()
    mouseGesture.cancel()
    stopTracking()
    unlockCursor()
    const previous = secondarySwitchBack
    secondarySwitchBack = undefined
    if (restoreTool && previous) switchToolTo(previous)
}

const mousedown = (event: MouseEvent) => {
    isHovering = false
    closeContextMenu()
    // Selected page text would keep its native copy over the objects pressed after it.
    clearPageSelection()
    const p = toP(event)
    updateViewPointer(p)

    view.scrollingY = undefined
    view.scrollingX = undefined
    stopPlayer(false)
    if (!mouseGesture.pointerCount) beginAudioPreviewInteraction()

    if (
        !mouseGesture.pointerCount &&
        event.buttons & 2 &&
        !secondarySwitchBack &&
        tool.value.secondaryTool !== false
    ) {
        secondarySwitchBack = toolName.value
        switchingSecondaryTool = true
        try {
            switchToolTo(
                settings.mouseSecondaryTool === 'selectContextMenu'
                    ? 'select'
                    : settings.mouseSecondaryTool,
            )
        } finally {
            switchingSecondaryTool = false
        }
    }

    if (
        settings.mouseSecondaryTool === 'selectContextMenu' &&
        tool.value.secondaryTool !== false &&
        !mouseGesture.pointerCount &&
        event.button === 2 &&
        event.buttons === 2 &&
        !event.ctrlKey &&
        !event.shiftKey &&
        !event.altKey &&
        !event.metaKey
    )
        contextClick = { x: p.x, y: p.y }

    // The press point is where dragStart decides; keep its cursor until release.
    if (!mouseGesture.pointerCount) lockCursor(tool.value.cursor?.(p.x, p.y) ?? 'default')

    if (!pressedPane && event.currentTarget instanceof Element) {
        pressedPane = event.currentTarget
        addEventListener('mousemove', trackMove, true)
        addEventListener('mouseup', trackUp, true)
    }
    mouseGesture.start([p])

    event.preventDefault()
}

const mousemove = (event: MouseEvent) => {
    if (isTracked(event)) return
    const p = toP(event)
    updateViewPointer(p)
    if (contextClick && Math.hypot(p.x - contextClick.x, p.y - contextClick.y) > 20)
        contextClick = undefined

    if (mouseGesture.pointerCount) {
        mouseGesture.move([p])
    } else if (!isDragging.value) {
        isHovering = true
        setViewHover(p.y)
        void tool.value.hover?.(p.x, p.y, p.modifiers)
    }

    event.preventDefault()
}

const mouseup = (event: MouseEvent) => {
    if (isTracked(event)) return
    const pane = pressedPane
    const p = toP(event)
    updateViewPointer(p)

    const showMenu =
        contextClick &&
        event.button === 2 &&
        !event.ctrlKey &&
        !event.shiftKey &&
        !event.altKey &&
        !event.metaKey &&
        Math.hypot(p.x - contextClick.x, p.y - contextClick.y) <= 20
    contextClick = undefined
    if (showMenu) mouseGesture.cancel()
    else mouseGesture.end([p])

    if (!mouseGesture.pointerCount && secondarySwitchBack) {
        switchToolTo(secondarySwitchBack)
        secondarySwitchBack = undefined
    }
    if (!mouseGesture.pointerCount) {
        unlockCursor()
        stopTracking()
        // A release over the chart rests there again; leaving it does not.
        const over = pane ?? event.currentTarget
        if (event.type === 'mouseup' && over instanceof Element && event.target instanceof Node)
            isHovering = over.contains(event.target)
    }

    if (showMenu) openContextMenu(p.x, p.y)
    event.preventDefault()
}

const mouseleave = (event: MouseEvent) => {
    isHovering = false
    contextClick = undefined
    // A press continues outside the pane; only its release lands it.
    if (!pressedPane) mouseup(event)
}

const wheel = (event: WheelEvent) => {
    const bounds = getControlBounds(view)
    if (event.ctrlKey) {
        if (event.shiftKey) {
            if (event.deltaY) {
                if (event.deltaY > 0) {
                    void zoomXOut.execute()
                } else {
                    void zoomXIn.execute()
                }
            }
            if (event.deltaX) {
                if (event.deltaX > 0) {
                    void zoomYOut.execute()
                } else {
                    void zoomYIn.execute()
                }
            }
        } else {
            if (event.deltaY) {
                if (event.deltaY > 0) {
                    void zoomYOut.execute()
                } else {
                    void zoomYIn.execute()
                }
            }
            if (event.deltaX) {
                if (event.deltaX > 0) {
                    void zoomXOut.execute()
                } else {
                    void zoomXIn.execute()
                }
            }
        }
    } else {
        const mode = event.deltaMode
        if (event.shiftKey ? event.deltaX : event.deltaY) cancelPreviewFollow()
        if (event.shiftKey) {
            switch (mode) {
                case WheelEvent.DOM_DELTA_PIXEL:
                    scrollViewXBy(event.deltaY, settings.mouseSmoothScrolling)
                    if (event.deltaX) scrollViewYBy(-event.deltaX, settings.mouseSmoothScrolling)
                    break
                case WheelEvent.DOM_DELTA_LINE:
                    scrollViewXBy(event.deltaY * 20, settings.mouseSmoothScrolling)
                    if (event.deltaX)
                        scrollViewYBy(-(event.deltaX * 20), settings.mouseSmoothScrolling)
                    break
                case WheelEvent.DOM_DELTA_PAGE:
                    scrollViewXBy(event.deltaY * bounds.w, settings.mouseSmoothScrolling)
                    if (event.deltaX)
                        scrollViewYBy(-event.deltaX * bounds.h, settings.mouseSmoothScrolling)
                    break
            }
        } else {
            switch (mode) {
                case WheelEvent.DOM_DELTA_PIXEL:
                    scrollViewXBy(event.deltaX, settings.mouseSmoothScrolling)
                    if (event.deltaY) scrollViewYBy(-event.deltaY, settings.mouseSmoothScrolling)
                    break
                case WheelEvent.DOM_DELTA_LINE:
                    scrollViewXBy(event.deltaX * 20, settings.mouseSmoothScrolling)
                    if (event.deltaY)
                        scrollViewYBy(-(event.deltaY * 20), settings.mouseSmoothScrolling)
                    break
                case WheelEvent.DOM_DELTA_PAGE:
                    scrollViewXBy(event.deltaX * bounds.w, settings.mouseSmoothScrolling)
                    if (event.deltaY)
                        scrollViewYBy(-event.deltaY * bounds.h, settings.mouseSmoothScrolling)
                    break
            }
        }
    }

    event.preventDefault()
}

// Scrolling under a still mouse, as playback, the wheel or a pan does, moves what it hovers.
watch([viewBox, () => view.x, () => view.y], () => {
    if (!isHovering || view.isHoverHidden || editorNavigation.value) return
    if (mouseGesture.pointerCount || isDragging.value) return
    const { x, y, modifiers } = view.pointer
    setViewHover(y)
    void tool.value.hover?.(x, y, modifiers)
})

export const mouseControlListeners = {
    mousedown,
    mousemove,
    mouseup,
    mouseleave,
    wheel,
}
