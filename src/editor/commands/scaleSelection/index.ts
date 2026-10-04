import type { Command } from '..'
import { i18n } from '../../../i18n'
import type { ScaleAxis } from '../../../state/operations/scaleValues'
import { notify } from '../../notification'
import { showToolModal } from '../../toolModals'
import ScaleSelectionIcon from './ScaleSelectionIcon.vue'
import ScaleSelectionModal from './ScaleSelectionModal.vue'
import { beginScalingSession, cancelScalingSession, scalingSession } from './session'

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
            const session = beginScalingSession(axis)
            if (!session) {
                notify(() => labels().noSelected)
                return
            }
            await showToolModal(ScaleSelectionModal, { sessionId: session.id })
            if (scalingSession.value?.id === session.id) cancelScalingSession()
        },
    }
}
export const scaleBeat = createScaleCommand('beat')
export const scaleElevation = createScaleCommand('elevation')
