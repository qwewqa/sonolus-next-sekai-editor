import { settings } from '../../settings'
import { beginAudioPreviewInteraction } from '../audioPreview'
import { openContextMenu } from '../contextMenu'
import { stopPlayer } from '../player'
import { tool } from '../tools'
import { updateViewPointer, view } from '../view'
import { gesture } from './gestures/gesture'
import { drag, isDragging } from './gestures/recognizers/drag'
import { pan } from './gestures/recognizers/pan'
import { tap } from './gestures/recognizers/tap'
import { threeTap } from './gestures/recognizers/threeTap'
import { twoTap } from './gestures/recognizers/twoTap'
import { zoomX } from './gestures/recognizers/zoomX'
import { zoomY } from './gestures/recognizers/zoomY'
import { clearPageSelection } from './pageSelection'

const touchGesture = gesture(zoomY(), zoomX(), pan(), drag(true), tap(), twoTap(), threeTap())

export const hasTouchControls = () => touchGesture.pointerCount > 0

// Holding one finger still opens the context menu, like a mouse right click.
// Movement beyond the slop is left to the drag and pan recognizers.
const longPressDelay = 500
const longPressSlop = 10
let longPress:
    { id: number; sx: number; sy: number; x: number; y: number; timer: number } | undefined

const cancelLongPress = () => {
    if (longPress) clearTimeout(longPress.timer)
    longPress = undefined
}

const startLongPress = (id: number, x: number, y: number) => {
    cancelLongPress()
    if (!settings.touchLongPressContextMenu || tool.value.secondaryTool === false) return

    longPress = {
        id,
        sx: x,
        sy: y,
        x,
        y,
        timer: window.setTimeout(() => {
            // A mouse drag holds the tool.
            if (!longPress || touchGesture.pointerCount !== 1 || isDragging.value) return
            const { x, y } = longPress
            longPress = undefined
            touchGesture.cancel()
            openContextMenu(x, y)
        }, longPressDelay),
    }
}

export const cancelTouchControls = () => {
    cancelLongPress()
    touchGesture.cancel()
}

const toPs = (event: TouchEvent) =>
    [...event.changedTouches].map((touch) => ({
        id: touch.identifier,
        x: touch.clientX,
        y: touch.clientY,
        modifiers: {
            ctrl: event.ctrlKey || event.metaKey,
            shift: event.shiftKey,
        },
    }))

const touchstart = (event: TouchEvent) => {
    clearPageSelection()
    const ps = toPs(event)
    updateViewPointer(ps[0])

    view.scrollingY = undefined
    view.scrollingX = undefined
    stopPlayer(false)
    if (!touchGesture.pointerCount) beginAudioPreviewInteraction()

    touchGesture.start(ps)

    const [first] = ps
    if (first && ps.length === 1 && touchGesture.pointerCount === 1)
        startLongPress(first.id, first.x, first.y)
    else cancelLongPress()

    event.preventDefault()
}

const touchmove = (event: TouchEvent) => {
    const ps = toPs(event)
    updateViewPointer(ps[0])

    const moved = longPress && ps.find(({ id }) => id === longPress?.id)
    if (longPress && moved) {
        longPress.x = moved.x
        longPress.y = moved.y
        if (Math.hypot(moved.x - longPress.sx, moved.y - longPress.sy) > longPressSlop)
            cancelLongPress()
    }

    touchGesture.move(ps)

    event.preventDefault()
}

const touchend = (event: TouchEvent) => {
    const ps = toPs(event)
    updateViewPointer(ps[0])

    cancelLongPress()
    touchGesture.end(ps)

    event.preventDefault()
}

const touchcancel = (event: TouchEvent) => {
    const ps = toPs(event)
    updateViewPointer(ps[0])

    cancelLongPress()
    touchGesture.cancel()

    event.preventDefault()
}

export const touchControlListeners = {
    touchstart,
    touchmove,
    touchend,
    touchcancel,
}
