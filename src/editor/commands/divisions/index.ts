import type { Command } from '..'
import { i18n } from '../../../i18n'
import { interpolate } from '../../../utils/interpolate'
import { notify } from '../../notification'
import { view } from '../../view'
import TextIcon from '../TextIcon.vue'
import LaneDivisionIcon from './LaneDivisionIcon.vue'

export const division = (division: number, axis: 'beat' | 'lane' = 'beat'): Command => ({
    title: interpolate(
        () =>
            axis === 'lane'
                ? i18n.value.commands.laneDivisions.title
                : i18n.value.commands.divisions.title,
        `${division}`,
    ),
    icon: {
        is: axis === 'lane' ? LaneDivisionIcon : TextIcon,
        props: {
            title: `1/${division}`,
        },
    },

    execute() {
        if (axis === 'lane') view.laneDivision = division
        else view.division = division

        notify(
            interpolate(
                () =>
                    axis === 'lane'
                        ? i18n.value.commands.laneDivisions.switched
                        : i18n.value.commands.divisions.switched,
                `${division}`,
            ),
        )
    },
})
