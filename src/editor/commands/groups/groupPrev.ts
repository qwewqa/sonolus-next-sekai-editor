import type { Command } from '..'
import { groups } from '../../../history/groups'
import { i18n } from '../../../i18n'
import { groupScope } from '../../scope'
import { stepFocus } from '../../scopeRules'
import { view } from '../../view'
import GroupPrevIcon from './GroupPrevIcon.vue'

export const groupPrev: Command = {
    title: () => i18n.value.commands.groups.groupPrev.title,
    icon: {
        is: GroupPrevIcon,
    },

    // Reveals the previous entry; before the first one comes All, which shows everything.
    execute() {
        const id = stepFocus([...groups.value.keys()], view.groupId, -1)
        if (id === undefined) groupScope.focusAll()
        else groupScope.focus(id)
    },
}
