import type { Command } from '..'
import { i18n } from '../../../i18n'
import { notify } from '../../notification'
import { isSidebarVisible } from '../../sidebars'
import { showToolModal } from '../../toolModals'
import { switchToolTo } from '../../tools'
import BrushIcon from './BrushIcon.vue'
import BrushPropertiesModal from './BrushPropertiesModal.vue'

export const brush: Command = {
    title: () => i18n.value.commands.brush.title,
    icon: {
        is: BrushIcon,
    },

    execute() {
        switchToolTo('brush')

        notify(() => i18n.value.commands.brush.switched)

        if (!isSidebarVisible.value) {
            void showToolModal(BrushPropertiesModal, {})
        }
    },
}
