import { settings } from '../../settings'
import { beginAudioPreviewInteraction } from '../audioPreview'
import { zoomXIn } from '../commands/zooms/zoomXIn'
import { zoomXOut } from '../commands/zooms/zoomXOut'
import { zoomYIn } from '../commands/zooms/zoomYIn'
import { zoomYOut } from '../commands/zooms/zoomYOut'
import { closeContextMenu, openContextMenu } from '../contextMenu'
import { getControlBounds } from '../navigation'
import { cancelPreviewFollow, stopPlayer } from '../player'
import { switchToolTo, tool, toolName, type ToolName } from '../tools'
import { scrollViewXBy, scrollViewYBy, setViewHover, updateViewPointer, view } from '../view'
import { lockCursor, unlockCursor } from './cursor'
import { gesture } from './gestures/gesture'
import { drag } from './gestures/recognizers/drag'
import { tap } from './gestures/recognizers/tap'

const mouseGesture = gesture(drag(false), tap())

export const hasMouseControls = () => mouseGesture.pointerCount > 0

const toP = (event: MouseEvent) => ({
    id: 1,
    x: event.clientX,
    y: event.clientY,
    modifiers: {
        ctrl: event.ctrlKey,
        shift: event.shiftKey,
    },
})

let secondarySwitchBack: ToolName | undefined
let switchingSecondaryTool = false
let contextClick: { x: number; y: number } | undefined

export const cancelMouseControls = (restoreTool = true) => {
    if (switchingSecondaryTool) return
    contextClick = undefined
    closeContextMenu()
    mouseGesture.cancel()
    unlockCursor()
    const previous = secondarySwitchBack
    secondarySwitchBack = undefined
    if (restoreTool && previous) switchToolTo(previous)
}

const mousedown = (event: MouseEvent) => {
    closeContextMenu()
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

    mouseGesture.start([p])

    event.preventDefault()
}

const mousemove = (event: MouseEvent) => {
    const p = toP(event)
    updateViewPointer(p)
    if (contextClick && Math.hypot(p.x - contextClick.x, p.y - contextClick.y) > 20)
        contextClick = undefined

    if (mouseGesture.pointerCount) {
        mouseGesture.move([p])
    } else {
        setViewHover(p.y)
        void tool.value.hover?.(p.x, p.y, p.modifiers)
    }

    event.preventDefault()
}

const mouseup = (event: MouseEvent) => {
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
    if (!mouseGesture.pointerCount) unlockCursor()

    if (showMenu) openContextMenu(p.x, p.y)
    event.preventDefault()
}

const mouseleave = (event: MouseEvent) => {
    contextClick = undefined
    mouseup(event)
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

export const mouseControlListeners = {
    mousedown,
    mousemove,
    mouseup,
    mouseleave,
    wheel,
}
