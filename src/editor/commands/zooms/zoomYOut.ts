import type { Command } from '..'
import { i18n } from '../../../i18n'
import { getVerticalScale, setVerticalScale } from '../../navigation'
import { notify } from '../../notification'
import ZoomYOutIcon from './ZoomYOutIcon.vue'

export const zoomYOut: Command = {
    title: () => i18n.value.commands.zooms.zoomYOut.title,
    icon: {
        is: ZoomYOutIcon,
    },

    execute() {
        setVerticalScale(getVerticalScale() / 1.1)

        notify(() => i18n.value.commands.zooms.zoomYOut.zoomed)
    },
}
