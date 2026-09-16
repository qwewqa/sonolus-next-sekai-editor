import type { InjectionKey, Ref } from 'vue'

// Selected-object forms can preview number edits without making every input
// event an undo step. Other number fields retain their change-event behavior.
export type NumberEdit = {
    revision: Readonly<Ref<number>>
    preview: (owner: symbol, update: () => void) => void
    invalidate: (owner: symbol) => void
    commit: (owner: symbol) => void
    cancel: (owner: symbol) => void
}

export const numberEditKey: InjectionKey<NumberEdit> = Symbol('number edit')
