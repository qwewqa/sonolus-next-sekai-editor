/** Whether a keydown belongs to IME composition; Chrome's first one has keyCode 229 but not isComposing. */
export const isComposingKey = (event: KeyboardEvent) =>
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    event.isComposing || event.keyCode === 229
