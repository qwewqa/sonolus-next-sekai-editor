import { computed, inject, type InjectionKey, type Ref } from 'vue'

/** Whether fields below name their object kind, as Selection does across kinds. */
export const qualifiedLabelsKey: InjectionKey<Ref<boolean>> = Symbol('qualified labels')

const unqualified = computed(() => false)

export const useQualifiedLabels = () => inject(qualifiedLabelsKey, unqualified)
