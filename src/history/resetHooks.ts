// A dependency-free registry, so view-state modules can subscribe without
// importing the history module (which imports the editor tools).
const listeners = new Set<() => void>()

/** Runs after a new chart is loaded or history is replaced. */
export const onResetState = (listener: () => void) => {
    listeners.add(listener)
}

export const notifyResetState = () => {
    for (const listener of listeners) listener()
}
