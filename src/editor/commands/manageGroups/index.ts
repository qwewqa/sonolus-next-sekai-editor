import type { Command } from '..'
import { i18n } from '../../../i18n'
import { showModal } from '../../../modals'
import { isPanelEnabled, showPanel } from '../../workspace'
import ManageGroupsModal from './manageGroups/ManageGroupsModal.vue'
import ManageGroupsIcon from './ManageGroupsIcon.vue'

export const manageGroups: Command = {
    title: () => i18n.value.commands.manageGroups.title,
    icon: {
        is: ManageGroupsIcon,
    },

    execute() {
        // A disabled panel keeps the manager reachable as a dialog.
        if (isPanelEnabled('groups')) showPanel('groups')
        else void showModal(ManageGroupsModal, {})
    },
}
