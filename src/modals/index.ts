import { computed, shallowReactive, type Component, type ComponentInstance } from 'vue'

let id = 0

export type Modal = {
    id: number
    is: Component
    props: object
    resolve: (result?: never) => void
    presentation?: 'tool'
    pane?: 'main' | 'elevation'
}

export const modals = shallowReactive<Modal[]>([])

export const isToolModalOpen = computed(() => modals.some((modal) => modal.presentation === 'tool'))

/** Dialogs that hold the editor; tool dialogs float over a live chart instead. */
export const isBlockingModalOpen = computed(() =>
    modals.some((modal) => modal.presentation !== 'tool'),
)

export const closeModal = (modal: Modal, result?: never) => {
    const index = modals.indexOf(modal)
    if (index === -1) return
    modals.splice(index, 1)
    modal.resolve(result)
}

export type ModalProps<T extends Component> = ComponentInstance<T>['$props']

type ModalResult<T extends Component> = ComponentInstance<T>['$emit'] extends (
    event: 'close',
    result: infer R,
) => void
    ? R
    : never

export const showModal = <T extends Component>(
    component: T,
    props: ModalProps<T>,
    options?: Pick<Modal, 'presentation' | 'pane'>,
) =>
    new Promise<ModalResult<T> | undefined>((resolve) => {
        modals.push({
            id: id++,
            is: component,
            props,
            resolve,
            ...options,
        })
    })
