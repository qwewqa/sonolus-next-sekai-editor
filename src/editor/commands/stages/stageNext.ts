import type { Command } from '..'
import { checkDynamicStages } from '../../../history/dynamicStages.ts'
import { stages } from '../../../history/stages'
import { i18n } from '../../../i18n'
import { stageScope } from '../../scope'
import { view } from '../../view'
import StageNextIcon from './StageNextIcon.vue'

export const stageNext: Command = {
    title: () => i18n.value.commands.stages.stageNext.title,
    icon: {
        is: StageNextIcon,
    },

    // Focusing an entry also reveals it if it was explicitly hidden.
    async execute() {
        if (!(await checkDynamicStages())) return

        const ids = [...stages.value.keys()]
        const index = view.stageId ? ids.indexOf(view.stageId) : -1

        if (index < 0) {
            stageScope.focus(ids[0])
        } else if (index === ids.length - 1) {
            stageScope.focus(undefined)
        } else {
            stageScope.focus(ids[index + 1])
        }
    },
}
