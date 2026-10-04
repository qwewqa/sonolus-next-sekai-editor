import type { Command } from '..'
import { i18n } from '../../../i18n'
import { showModal } from '../../../modals'
import { interpolate } from '../../../utils/interpolate'
import { notify } from '../../notification'
import { view } from '../../view'
import TextIcon from '../TextIcon.vue'
import CustomDivisionModal from './CustomDivisionModal.vue'
import LaneDivisionIcon from './LaneDivisionIcon.vue'

const createCustomDivision = (axis: 'beat' | 'lane'): Command => ({
    title: () =>
        axis === 'lane'
            ? i18n.value.commands.laneDivisions.custom.title
            : i18n.value.commands.divisions.custom.title,
    icon: {
        is: axis === 'lane' ? LaneDivisionIcon : TextIcon,
        props: {
            title: '1/n',
        },
    },

    async execute() {
        const division: number | undefined = await showModal(CustomDivisionModal, { axis })
        if (!division || !Number.isSafeInteger(division) || division < 1) return

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

export const divisionCustom = createCustomDivision('beat')
export const laneDivisionCustom = createCustomDivision('lane')
