/** The item an arrow, Home or End key moves a menu to; arrows stop at the ends. */
export const menuKeyIndex = (key: string, index: number, count: number) => {
    if (!count) return
    switch (key) {
        case 'Home':
            return 0
        case 'End':
            return count - 1
        case 'ArrowDown':
            return index < 0 ? 0 : Math.min(index + 1, count - 1)
        case 'ArrowUp':
            return index < 0 ? count - 1 : Math.max(index - 1, 0)
    }
}
