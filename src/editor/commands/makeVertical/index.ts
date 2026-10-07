import type { Command } from '..'
import { pushState, state } from '../../../history'
import { i18n } from '../../../i18n'
import { makeVertical as applyMakeVertical } from '../../../state/operations/makeVertical'
import { interpolate } from '../../../utils/interpolate'
import { notify } from '../../notification'
import { view } from '../../view'
import MakeVerticalIcon from './MakeVerticalIcon.vue'

export const makeVertical: Command = {
    title: () => i18n.value.commands.makeVertical.title,
    icon: { is: MakeVerticalIcon },
    execute() {
        const source = state.value
        const notes = new Set(source.selectedEntities.filter((entity) => entity.type === 'note'))
        if (!notes.size) {
            notify(() => i18n.value.commands.makeVertical.noSelected)
            return
        }
        const result = applyMakeVertical(source, source.selectedEntities)
        if (result === source) {
            const beat = [...notes][0]?.beat
            const unchanged = [...notes].every((note) => note.beat === beat)
            notify(() =>
                unchanged
                    ? i18n.value.commands.makeVertical.unchanged
                    : i18n.value.commands.makeVertical.invalid,
            )
            return
        }
        const message = interpolate(() => i18n.value.commands.makeVertical.made, `${notes.size}`)
        pushState(message, result)
        view.entities = { hovered: [], creating: [] }
        notify(message)
    },
}
