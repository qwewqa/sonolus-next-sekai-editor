import type { Command } from '..'
import { checkDynamicStages } from '../../../history/dynamicStages.ts'
import { stages } from '../../../history/stages'
import { i18n } from '../../../i18n'
import { stageScope } from '../../scope'
import { stepFocus } from '../../scopeRules'
import { view } from '../../view'
import StageNextIcon from './StageNextIcon.vue'

export const stageNext: Command = {
    title: () => i18n.value.commands.stages.stageNext.title,
    icon: {
        is: StageNextIcon,
    },

    // Reveals the next entry; past the last one comes All, which shows everything.
    async execute() {
        if (!(await checkDynamicStages())) return

        const id = stepFocus([...stages.value.keys()], view.stageId, 1)
        if (id === undefined) stageScope.focusAll()
        else stageScope.focus(id)
    },
}
