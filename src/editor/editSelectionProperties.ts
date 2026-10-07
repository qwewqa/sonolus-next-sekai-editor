import { computed, nextTick } from 'vue'
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

// The shown Selection section's first field, or its heading.
const shownSelectionTarget = async (toField: boolean) => {
    editSelectionProperties()
    if (!isSidebarVisible.value) return
    await nextTick()
    const body = document.getElementById('properties-section-selection')
    if (!body) return
    const target =
        (toField
            ? body.querySelector<HTMLElement>(
                  'input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
              )
            : null) ?? body.querySelector<HTMLElement>('.properties-block h3')
    target?.scrollIntoView({ block: 'nearest' })
    return target
}

/** Also scrolls the shown panel's Selection section to its first rows, leaving focus alone. */
export const revealSelectionProperties = async () => {
    await shownSelectionTarget(false)
}

/**
 * Also moves focus into the shown panel's Selection section: its first field,
 * or its heading so a tap never summons the on-screen keyboard.
 */
export const focusSelectionProperties = async (toField: boolean) => {
    ;(await shownSelectionTarget(toField))?.focus({ preventScroll: true })
}
