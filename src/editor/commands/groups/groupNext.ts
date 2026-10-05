import type { Command } from '..'
import { groups } from '../../../history/groups'
import { i18n } from '../../../i18n'
import { groupScope } from '../../scope'
import { stepFocus } from '../../scopeRules'
import { view } from '../../view'
import GroupNextIcon from './GroupNextIcon.vue'

export const groupNext: Command = {
    title: () => i18n.value.commands.groups.groupNext.title,
    icon: {
        is: GroupNextIcon,
    },

    // Reveals the next entry; past the last one comes All, which shows everything.
    execute() {
        const id = stepFocus([...groups.value.keys()], view.groupId, 1)
        if (id === undefined) groupScope.focusAll()
        else groupScope.focus(id)
    },
}
