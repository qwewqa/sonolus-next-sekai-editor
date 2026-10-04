import type { Command } from '..'
import { i18n } from '../../../i18n'
import { notify } from '../../notification'
import { view } from '../../view'
import SnappingIcon from './SnappingIcon.vue'

export const laneSnapping: Command = {
    title: () => i18n.value.commands.laneSnapping.title,
    icon: { is: SnappingIcon, props: { class: '-rotate-90' } },
    execute() {
        const snapping = view.laneSnapping === 'absolute' ? 'relative' : 'absolute'
        view.laneSnapping = snapping
        notify(() =>
            snapping === 'absolute'
                ? i18n.value.commands.laneSnapping.absolute
                : i18n.value.commands.laneSnapping.relative,
        )
    },
}
