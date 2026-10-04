import type { Command } from '..'
import type { ScaleAxis } from '../../../state/operations/scaleValues'
import { notify } from '../../notification'
import { showToolModal } from '../../toolModals'
import ScaleSelectionIcon from './ScaleSelectionIcon.vue'
import ScaleSelectionModal from './ScaleSelectionModal.vue'
import { getScaleLabels } from './labels'
import { beginScalingSession, cancelScalingSession, scalingSession } from './session'

const createScaleCommand = (axis: ScaleAxis): Command => {
    const labels = () => getScaleLabels(axis)
    return {
        title: () => labels().title,
        icon: {
            is: ScaleSelectionIcon,
            props: { axis },
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
export const scaleWidth = createScaleCommand('width')
