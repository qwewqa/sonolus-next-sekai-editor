import { computed } from 'vue'
import { selectedEntities } from '../history/selectedEntities'
import { isEditableEntity } from '../state/operations/editable'
import { isSidebarVisible, revealPropertiesSection } from './sidebars'
import { showToolModal } from './toolModals'
import SelectionPropertiesModal from './workspace/properties/SelectionPropertiesModal.vue'

/** Whether the selection has properties to edit. */
export const canEditSelectionProperties = computed(() =>
    selectedEntities.value.some(isEditableEntity),
)

/**
 * Shows the selection's properties without changing them, following the rule
 * every command uses: the visible panel, else a dialog. The dialog names one
 * kind when only one is selected.
 */
export const editSelectionProperties = () => {
    if (isSidebarVisible.value) {
        revealPropertiesSection('selection')
        return
    }
    const kinds = new Set(selectedEntities.value.filter(isEditableEntity).map(({ type }) => type))
    const [kind] = kinds
    void showToolModal(SelectionPropertiesModal, {
        kind: kinds.size === 1 ? kind : undefined,
    })
}
