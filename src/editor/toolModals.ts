import type { Component } from 'vue'
import { closeModal, modals, showModal, type Modal, type ModalProps } from '../modals'
import { isElevationEditorOpen, isElevationSideBySide } from './elevation/state'
import { editorNavigation } from './navigation'
import { view } from './view'

export type ToolModalPane = NonNullable<Modal['pane']>

export const hasToolModal = (pane: ToolModalPane) =>
    modals.some((modal) => modal.presentation === 'tool' && modal.pane === pane)

export const showToolModal = <T extends Component>(component: T, props: ModalProps<T>) => {
    for (const modal of [...modals]) {
        if (modal.presentation === 'tool') closeModal(modal)
    }
    view.entities = { hovered: [], creating: [] }
    return showModal(component, props, {
        presentation: 'tool',
        pane:
            editorNavigation.value || (isElevationEditorOpen.value && !isElevationSideBySide.value)
                ? 'elevation'
                : 'main',
    })
}
