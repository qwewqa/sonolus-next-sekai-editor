import type { Command } from '..'
import { i18n } from '../../../i18n'
import { interpolate } from '../../../utils/interpolate.ts'
import { alignNear } from '../../../utils/math.ts'
import { notify } from '../../notification.ts'
import { view } from '../../view.ts'
import NoteSizeIcon from './NoteSizeIcon.vue'

export const increaseNoteSize: Command = {
    title: () => i18n.value.commands.noteSizes.increase.title,
    icon: {
        is: NoteSizeIcon,
    },

    execute() {
        view.noteSize = alignNear(view.noteSize + 1 / view.laneDivision, view.laneDivision)

        notify(interpolate(() => i18n.value.commands.noteSizes.changed, `${view.noteSize}`))
    },
}
