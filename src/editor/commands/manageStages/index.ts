import type { Command } from '..'
import { i18n } from '../../../i18n'
import { showModal } from '../../../modals'
import { isPanelEnabled, showPanel } from '../../workspace'
import ManageStagesModal from './manageStages/ManageStagesModal.vue'
import ManageStagesIcon from './ManageStagesIcon.vue'

export const manageStages: Command = {
    title: () => i18n.value.commands.manageStages.title,
    icon: {
        is: ManageStagesIcon,
    },

    execute() {
        // Both presentations explain disabled dynamic stages and offer to
        // enable them, so opening the manager never changes the level. A
        // disabled panel keeps the manager reachable as a dialog.
        if (isPanelEnabled('stages')) showPanel('stages')
        else void showModal(ManageStagesModal, {})
    },
}
