import type { Command } from '..'
import { groups } from '../../../history/groups'
import { i18n } from '../../../i18n'
import { groupScope } from '../../scope'
import { view } from '../../view'
import GroupNextIcon from './GroupNextIcon.vue'

export const groupNext: Command = {
    title: () => i18n.value.commands.groups.groupNext.title,
    icon: {
        is: GroupNextIcon,
    },

    // Focusing an entry also reveals it if it was explicitly hidden.
    execute() {
        const ids = [...groups.value.keys()]
        const index = view.groupId ? ids.indexOf(view.groupId) : -1

        if (index < 0) {
            groupScope.focus(ids[0])
        } else if (index === ids.length - 1) {
            groupScope.focus(undefined)
        } else {
            groupScope.focus(ids[index + 1])
        }
    },
}
