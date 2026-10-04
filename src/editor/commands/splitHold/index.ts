import type { Command } from '..'
import { pushState, state } from '../../../history'
import { i18n } from '../../../i18n'
import { getSplitHoldNotes, splitHold as split } from '../../../state/operations/splitHold'
import { interpolate } from '../../../utils/interpolate'
import { notify } from '../../notification'
import { view } from '../../view'
import SplitHoldIcon from './SplitHoldIcon.vue'

export const splitHold: Command = {
    title: () => i18n.value.commands.splitHold.title,
    icon: { is: SplitHoldIcon },
    execute() {
        const source = state.value
        const count = getSplitHoldNotes(source, source.selectedEntities).length
        if (!count) {
            notify(() => i18n.value.commands.splitHold.noConnections)
            return
        }
        const message = interpolate(() => i18n.value.commands.splitHold.split, `${count}`)
        pushState(message, split(source, source.selectedEntities))
        view.entities = { hovered: [], creating: [] }
        notify(message)
    },
}
