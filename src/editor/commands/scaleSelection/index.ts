import type { Command } from '..'
import { pushState, state } from '../../../history'
import { i18n } from '../../../i18n'
import { showModal } from '../../../modals'
import { hasSameChartData } from '../../../state/data'
import { scaleSelection } from '../../../state/operations/scaleSelection'
import {
    canScaleSelection,
    getScaleEntities,
    type ScaleAxis,
} from '../../../state/operations/scaleValues'
import { interpolate } from '../../../utils/interpolate'
import { notify } from '../../notification'
import { view } from '../../view'
import ScaleSelectionIcon from './ScaleSelectionIcon.vue'
import ScaleSelectionModal from './ScaleSelectionModal.vue'

const createScaleCommand = (axis: ScaleAxis): Command => {
    const labels = () =>
        axis === 'beat' ? i18n.value.commands.scaleBeat : i18n.value.commands.scaleElevation
    return {
        title: () => labels().title,
        icon: {
            is: ScaleSelectionIcon,
            props: axis === 'elevation' ? { class: '-rotate-90' } : undefined,
        },
        async execute() {
            const source = state.value
            const selected = [...source.selectedEntities]
            if (!canScaleSelection(selected, axis, source)) {
                notify(() => labels().noSelected)
                return
            }
            const factor = await showModal(ScaleSelectionModal, { source, selected, axis })
            if (factor === undefined || !hasSameChartData(source, state.value)) return
            const result = scaleSelection(state.value, selected, axis, factor)
            if (result === state.value) return
            const message = interpolate(
                () => labels().scaled,
                `${getScaleEntities(selected, axis, source).length}`,
            )
            pushState(message, result)
            view.entities = { hovered: [], creating: [] }
            notify(message)
        },
    }
}
export const scaleBeat = createScaleCommand('beat')
export const scaleElevation = createScaleCommand('elevation')
