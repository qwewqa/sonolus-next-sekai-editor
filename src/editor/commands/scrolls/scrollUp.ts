import type { Command } from '..'
import { i18n } from '../../../i18n'
import { getControlBounds } from '../../navigation'
import { scrollViewYBy, view } from '../../view'
import ScrollUpIcon from './ScrollUpIcon.vue'

export const scrollUp: Command = {
    title: () => i18n.value.commands.scrolls.scrollUp.title,
    icon: {
        is: ScrollUpIcon,
    },

    execute() {
        scrollViewYBy(getControlBounds(view).h * 0.05, true)
    },
}
