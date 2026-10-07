import type { Command } from '..'
import { selectedEntities } from '../../../history/selectedEntities'
import { i18n } from '../../../i18n'
import { isEditableEntity } from '../../../state/operations/editable'
import { canRemove, remove } from '../../tools/eraser'
import DeleteIcon from '../reset/ResetIcon.vue'

/** Whether the selection holds an object Delete removes. */
export const canDeleteSelection = () =>
    selectedEntities.value.some((entity) => isEditableEntity(entity) && canRemove(entity))

export const deleteSelection: Command = {
    title: () => i18n.value.contextMenu.delete,
    icon: {
        is: DeleteIcon,
    },

    execute() {
        if (canDeleteSelection()) remove(selectedEntities.value)
    },
}
