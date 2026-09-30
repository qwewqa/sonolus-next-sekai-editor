import type { Command } from '..'
import { pushState, state } from '../../../history'
import { i18n } from '../../../i18n'
import { combineNotes as combine } from '../../../state/operations/combineNotes'
import { interpolate } from '../../../utils/interpolate'
import { notify } from '../../notification'
import { view } from '../../view'
import CombineNotesIcon from './CombineNotesIcon.vue'

export const combineNotes: Command = {
    title: () => i18n.value.commands.combineNotes.title,
    icon: { is: CombineNotesIcon },
    execute() {
        const source = state.value
        if (!source.selectedEntities.some((entity) => entity.type === 'note')) {
            notify(() => i18n.value.commands.combineNotes.noSelected)
            return
        }
        const combined = combine(source, source.selectedEntities)
        if (combined === source) {
            notify(() => i18n.value.commands.combineNotes.sameSlide)
            return
        }
        const count = combined.selectedEntities.filter((entity) => entity.type === 'note').length
        const message = interpolate(() => i18n.value.commands.combineNotes.combined, `${count}`)
        pushState(message, combined)
        view.entities = { hovered: [], creating: [] }
        notify(message)
    },
}
