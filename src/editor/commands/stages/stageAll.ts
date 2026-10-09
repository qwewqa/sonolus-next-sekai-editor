import type { Command } from '..'
import { checkDynamicStages } from '../../../history/dynamicStages.ts'
import { i18n } from '../../../i18n'
import { stageScope } from '../../scope'
import StageAllIcon from './StageAllIcon.vue'

export const stageAll: Command = {
    title: () => i18n.value.commands.stages.stageAll.title,
    icon: {
        is: StageAllIcon,
    },

    // Clears the focus, restoring saved visibility choices.
    async execute() {
        if (!(await checkDynamicStages())) return

        stageScope.focusAll()
    },
}
