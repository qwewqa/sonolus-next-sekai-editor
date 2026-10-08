import { ref, watch } from 'vue'
import { replaceState, state } from '../../../../history'
import { settings } from '../../../../settings'
import { time } from '../../../../time'
import { unlerp } from '../../../../utils/math'
import { getControlBounds } from '../../../navigation'
import { clearNotification, notification } from '../../../notification'
import { tool, type Tool } from '../../../tools'
import { scrollViewXBy, scrollViewYBy, view } from '../../../view'
import type { Modifiers } from '../pointer'
import type { Recognizer } from './recognizer'

export const isDragging = ref(0)

// An edge zone's inner bounds, moved to a held start point inside it.
const panZone = (held: number | undefined) => ({
    low: Math.min(0.2, held ?? 1),
    high: Math.max(0.8, held ?? 0),
})
// A point inside an edge zone, else none.
const holdIn = (p: number) => (p < 0.2 || p > 0.8 ? p : undefined)

export const drag = (quickScroll: boolean): Recognizer<1> => {
    const updates: {
        t: number
        dx: number
        dy: number
    }[] = []
    let active:
        | {
              type: 'drag'
              id: number
              tool: Tool
              state: (typeof state)['value']
              // The last notice the drag posted, if any.
              notice?: number
          }
        | {
              type: 'scroll'
              sx: number
              sy: number
              id: number
          }
        | undefined

    let update:
        | {
              x: number
              y: number
              modifiers: Modifiers
          }
        | undefined
    // Where a drag started inside an edge zone; it pans that way only from deeper.
    let held: { x?: number; y?: number } = {}

    watch(time, ({ delta }) => {
        if (!update) return
        const { x, y, modifiers } = update
        const bounds = getControlBounds(view)

        let updated = 0

        if (settings.dragToPanX) {
            const px = (x - bounds.x) / bounds.w
            if (holdIn(px) === undefined) held.x = undefined
            const { low, high } = panZone(held.x)
            if (px < low) {
                scrollViewXBy(-unlerp(low, 0, px) * bounds.w * delta)
                updated++
            } else if (px > high) {
                scrollViewXBy(unlerp(high, 1, px) * bounds.w * delta)
                updated++
            }
        }

        if (settings.dragToPanY) {
            const py = (y - bounds.y) / bounds.h
            if (holdIn(py) === undefined) held.y = undefined
            const { low, high } = panZone(held.y)
            if (py < low) {
                scrollViewYBy(unlerp(low, 0, py) * bounds.h * delta)
                updated++
            } else if (py > high) {
                scrollViewYBy(-unlerp(high, 1, py) * bounds.h * delta)
                updated++
            }
        }

        if (active?.type === 'drag') {
            const before = notification.value.id
            active.tool.dragUpdate?.(x, y, modifiers)
            if (notification.value.id !== before) active.notice = notification.value.id
        }

        if (!updated) {
            update = undefined
        }
    })

    return {
        count: 1,

        recognize([id, { isActive, sx, sy, x, y, modifiers }]) {
            if (!isActive) return false
            if (Math.hypot(x - sx, y - sy) <= 20) return false

            const bounds = getControlBounds(view)
            const p = (x - bounds.x) / bounds.w
            if (!quickScroll || p < 1 - settings.touchQuickScrollZone / 100) {
                // Tools hold one drag; another input's drag leaves this press inert.
                if (isDragging.value) return true
                const startState = state.value
                const noticeBefore = notification.value.id
                if (!tool.value.dragStart?.(sx, sy, modifiers)) return true

                isDragging.value++
                held = {
                    x: holdIn((sx - bounds.x) / bounds.w),
                    y: holdIn((sy - bounds.y) / bounds.h),
                }

                active = {
                    type: 'drag',
                    id,
                    tool: tool.value,
                    state: startState,
                    notice:
                        notification.value.id !== noticeBefore ? notification.value.id : undefined,
                }
                update = {
                    x,
                    y,
                    modifiers,
                }
                return true
            } else {
                active = {
                    type: 'scroll',
                    sx,
                    sy,
                    id,
                }
                return true
            }
        },

        update(pointers) {
            if (!active) return

            const p = pointers.get(active.id)
            if (!p) return

            if (active.type === 'drag') {
                if (p.isActive) {
                    update = {
                        x: p.x,
                        y: p.y,
                        modifiers: p.modifiers,
                    }
                } else {
                    isDragging.value--
                    const completed = active.tool
                    active = undefined
                    update = undefined
                    // Committing changes history synchronously. Boundary
                    // watchers must not cancel this already completed drag.
                    void completed.dragEnd?.(p.x, p.y, p.modifiers)
                }
            } else {
                const dx = p.x - active.sx
                const dy = p.y - active.sy

                scrollViewXBy(-dx)
                scrollViewYBy(dy)

                updates.push({
                    t: time.value.now,
                    dx,
                    dy,
                })
                active.sx = p.x
                active.sy = p.y
            }
        },

        reset(cancelled) {
            if (cancelled && active?.type === 'drag') {
                isDragging.value--
                const cancelled = active
                active = undefined
                update = undefined
                cancelled.tool.dragCancel?.()
                // Its own notice, such as "Moving", no longer holds.
                if (notification.value.id === cancelled.notice) clearNotification()
                // Selection tools update the current selection while dragging.
                // Restore it only if no committed edit/reset replaced the store.
                if (
                    state.value.store === cancelled.state.store &&
                    state.value.selectedEntities !== cancelled.state.selectedEntities
                ) {
                    replaceState({
                        ...state.value,
                        selectedEntities: cancelled.state.selectedEntities,
                    })
                }
                view.selection = undefined
                view.entities = { hovered: [], creating: [] }
            }
            if (!cancelled && active?.type === 'scroll' && settings.touchScrollInertia) {
                const dx = updates
                    .filter(({ t }) => time.value.now - t <= 0.1)
                    .reduce((sum, { dx }) => sum + dx, 0)
                view.scrollingX = {
                    type: 'inertia',
                    value: -dx / 0.1,
                }

                const dy = updates
                    .filter(({ t }) => time.value.now - t <= 0.1)
                    .reduce((sum, { dy }) => sum + dy, 0)
                view.scrollingY = {
                    type: 'inertia',
                    value: dy / 0.1,
                }
            }

            updates.length = 0
            active = undefined
            update = undefined
        },
    }
}
