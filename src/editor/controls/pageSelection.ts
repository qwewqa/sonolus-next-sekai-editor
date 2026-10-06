/** Drops page text selected outside fields, as a press would if the chart did not prevent it. */
export const clearPageSelection = () => {
    const selection = getSelection()
    if (!selection || selection.isCollapsed) return
    const node = selection.anchorNode
    const element = node instanceof Element ? node : node?.parentElement
    if (element?.closest('input, textarea, [contenteditable]:not([contenteditable="false"])'))
        return
    selection.removeAllRanges()
}
