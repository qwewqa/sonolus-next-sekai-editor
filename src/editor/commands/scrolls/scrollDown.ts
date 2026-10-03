import type { Command } from '..'
import { i18n } from '../../../i18n'
import { getControlBounds } from '../../navigation'
import { scrollViewYBy, view } from '../../view'
import ScrollDownIcon from './ScrollDownIcon.vue'

export const scrollDown: Command = {
    title: () => i18n.value.commands.scrolls.scrollDown.title,
    icon: {
        is: ScrollDownIcon,
    },

    execute() {
        scrollViewYBy(-getControlBounds(view).h * 0.05, true)
    },
}
