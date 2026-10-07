/**
 * A fit's stages alternate reads and writes; returning false ends that fit. Every
 * queued fit runs each stage before any runs the next, so layout is forced once per
 * stage however many fields fit.
 */
export type FitStage = () => unknown

const queued = new Map<object, FitStage[]>()
let microtask = false
let frame = 0

const run = () => {
    microtask = false
    if (frame) cancelAnimationFrame(frame)
    frame = 0
    let fits = [...queued.values()]
    queued.clear()
    for (let stage = 0; fits.length; stage++)
        fits = fits.filter((stages) => stages[stage]?.() !== false && stage + 1 < stages.length)
}

/** Fits after the current update, before paint; or, from observers, in the next frame. */
export const queueFit = (owner: object, stages: FitStage[], nextFrame = false) => {
    queued.set(owner, stages)
    if (!nextFrame) {
        if (!microtask) queueMicrotask(run)
        microtask = true
    } else if (!microtask && !frame) frame = requestAnimationFrame(run)
}

export const cancelFit = (owner: object) => queued.delete(owner)
