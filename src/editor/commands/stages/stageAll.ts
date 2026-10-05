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

    // Clears the focus and every hide, so everything shows.
    async execute() {
        if (!(await checkDynamicStages())) return

        stageScope.focusAll()
    },
}
