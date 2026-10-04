import type { InjectionKey, Ref } from 'vue'

export const modalTitleKey: InjectionKey<Ref<string>> = Symbol('modal title')
