import type { Command } from '..'
import { i18n } from '../../../i18n'
import { getControlBounds } from '../../navigation'
import { scrollViewYBy, view } from '../../view'
import ScrollPageDownIcon from './ScrollPageDownIcon.vue'

export const scrollPageDown: Command = {
    title: () => i18n.value.commands.scrolls.scrollPageDown.title,
    icon: {
        is: ScrollPageDownIcon,
    },

    execute() {
        scrollViewYBy(-getControlBounds(view).h, true)
    },
}
