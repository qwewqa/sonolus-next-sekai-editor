/** Whether a keydown types toward an item: one letter or digit without Ctrl, Alt or Meta. */
export const isTypeAheadKey = (
    event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'metaKey'>,
) => !event.ctrlKey && !event.altKey && !event.metaKey && /^[\p{L}\p{N}]$/u.test(event.key)

/**
 * Type-ahead over a list's labels, as WAI-ARIA menus and listboxes offer: keys typed
 * within the timeout build a prefix, and the next label starting with it, wrapping, is
 * chosen. One letter repeated cycles through its matches.
 */
export const createTypeAhead = (timeout = 500) => {
    let typed: string[] = []
    let at = -Infinity
    return (
        key: string,
        labels: readonly string[],
        current: number,
        now = Date.now(),
    ): number | undefined => {
        const char = key.toLocaleLowerCase()
        typed = now - at <= timeout ? [...typed, char] : [char]
        at = now
        const repeated = typed.every((typedChar) => typedChar === char)
        const prefix = repeated ? char : typed.join('')
        // A new or repeated letter moves on; a longer prefix may keep the current item.
        const start = repeated ? current + 1 : current
        for (let offset = 0; offset < labels.length; offset++) {
            const index = (((start + offset) % labels.length) + labels.length) % labels.length
            if (labels[index]?.toLocaleLowerCase().startsWith(prefix)) return index
        }
        return undefined
    }
}
