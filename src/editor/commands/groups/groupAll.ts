import type { Command } from '..'
import { i18n } from '../../../i18n'
import { groupScope } from '../../scope'
import GroupAllIcon from './GroupAllIcon.vue'

export const groupAll: Command = {
    title: () => i18n.value.commands.groups.groupAll.title,
    icon: {
        is: GroupAllIcon,
    },

    // Clears the focus and every hide, so everything shows.
    execute() {
        groupScope.focusAll()
    },
}
