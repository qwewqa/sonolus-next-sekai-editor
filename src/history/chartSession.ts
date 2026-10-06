import { onResetState } from './resetHooks'

const createId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

let id = createId()

// A new or opened chart starts a new session; its group and stage ids are unrelated.
onResetState(() => {
    id = createId()
})

/** Identifies the chart being edited, for telling its own clipboard data apart. */
export const chartSessionId = () => id
