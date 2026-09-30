import type { Command } from '..'
import { pushState, state } from '../../../history'
import { i18n } from '../../../i18n'
import { flipVertical as flip } from '../../../state/operations/flipVertical'
import { interpolate } from '../../../utils/interpolate'
import { notify } from '../../notification'
import { view } from '../../view'
import FlipIcon from '../flip/FlipIcon.vue'

export const flipVertical: Command = {
    title: () => i18n.value.commands.flipVertical.title,
    icon: { is: FlipIcon, props: { class: 'rotate-90' } },
    execute() {
        const source = state.value
        if (!source.selectedEntities.length) {
            notify(() => i18n.value.commands.flip.noSelected)
            return
        }
        const flipped = flip(source, source.selectedEntities)
        if (flipped === source) return
        const message = interpolate(
            () => i18n.value.commands.flipVertical.flipped,
            `${flipped.selectedEntities.length}`,
        )
        pushState(message, flipped)
        view.entities = { hovered: [], creating: [] }
        notify(message)
    },
}
