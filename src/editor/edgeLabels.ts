import { computed, reactive } from 'vue'
import { hasToolModal } from './toolModals'
import { view } from './view'

type Size = { width: number; height: number }
type Row = { time: Size; beat: Size }

/** A label's box in pane pixels. */
export type LabelBox = { left: number; right: number; top: number; bottom: number }

const row = (): Row => ({ time: { width: 0, height: 0 }, beat: { width: 0, height: 0 } })

/** The laid-out sizes of the time and beat labels over the chart's edges. */
export const edgeLabelSizes = reactive({ top: row(), bottom: row() })

// A docked dialog (up to 28rem wide, centered at the bottom) covers the lower
// labels in narrow panes; hidden there rather than left peeking out under its
// rounded corners.
export const lowerEdgeLabelsCovered = computed(() => hasToolModal('main') && view.w < 640)

const sizes = new WeakMap<Element, Size>()
let observer: ResizeObserver | undefined

/** Keeps `size` at the element's border box size. */
export const observeLabelSize = (element: Element, size: Size) => {
    observer ??= new ResizeObserver((entries) => {
        for (const entry of entries) {
            const target = sizes.get(entry.target)
            const box = entry.borderBoxSize[0]
            if (!target || !box) continue
            target.width = box.inlineSize
            target.height = box.blockSize
        }
    })
    sizes.set(element, size)
    observer.observe(element)
}

export const unobserveLabelSize = (element: Element) => {
    sizes.delete(element)
    observer?.unobserve(element)
}

/** Where the time (left) and beat (right) labels over the chart lie, in pane pixels. */
export const edgeLabelBoxes = computed(() => {
    const boxes: { left: LabelBox[]; right: LabelBox[] } = { left: [], right: [] }
    const add = ({ time, beat }: Row, top: number) => {
        boxes.left.push({ left: 0, right: time.width, top, bottom: top + time.height })
        boxes.right.push({
            left: view.w - beat.width,
            right: view.w,
            top,
            bottom: top + beat.height,
        })
    }
    const { top, bottom } = edgeLabelSizes
    add(top, 0)
    if (!lowerEdgeLabelsCovered.value)
        add(bottom, view.h - Math.max(bottom.time.height, bottom.beat.height))
    return boxes
})
