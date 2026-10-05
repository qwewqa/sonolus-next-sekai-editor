import { inject, type InjectionKey } from 'vue'

/** Names the unset value of optional fields below, such as "Unchanged" in the brush. */
export const emptyLabelKey: InjectionKey<() => string> = Symbol('empty label')

export const useEmptyLabel = () => inject(emptyLabelKey, undefined)
