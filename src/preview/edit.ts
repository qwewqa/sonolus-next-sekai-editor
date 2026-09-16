import { shallowRef } from 'vue'
import type { State } from '../state'

export type PreviewEdit = {
    source: State
    resolve: () => State
    dependencies?: readonly unknown[]
}

// Keep speculative edits out of undo history and resolve them only when a
// preview frame actually needs them. Pointer events can replace this several
// times before the next animation frame without building discarded states.
export const previewEdit = shallowRef<PreviewEdit>()

export const hasSamePreviewData = (left: State, right: State) =>
    left.store === right.store &&
    left.bpms === right.bpms &&
    left.groups === right.groups &&
    left.stages === right.stages &&
    left.isDynamicStages === right.isDynamicStages

export const setPreviewEdit = (
    source: State,
    build: () => State,
    dependencies?: readonly unknown[],
) => {
    const previous = previewEdit.value
    // A drag often emits many pointer updates inside the same snapped cell.
    // Callers can key the immutable target and changed fields to retain both
    // the pending/resolved transaction and the preview's compiled chart.
    if (
        dependencies &&
        previous?.dependencies?.length === dependencies.length &&
        hasSamePreviewData(previous.source, source) &&
        dependencies.every((value, index) => value === previous.dependencies?.[index])
    ) {
        return
    }

    let resolved: State | undefined
    previewEdit.value = {
        source,
        resolve: () => (resolved ??= build()),
        dependencies: dependencies && [...dependencies],
    }
}

export const clearPreviewEdit = () => {
    previewEdit.value = undefined
}

export const getPreviewState = (current: State, edit = previewEdit.value) =>
    edit && hasSamePreviewData(current, edit.source) ? edit.resolve() : current
