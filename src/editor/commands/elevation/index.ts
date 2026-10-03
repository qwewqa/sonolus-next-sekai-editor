import type { Command } from '..'
import { i18n } from '../../../i18n'
import {
    closeElevationEditor,
    isElevationEditorOpen,
    openElevationEditor,
} from '../../elevation/state'
import ElevationIcon from './ElevationIcon.vue'

export const elevation: Command = {
    title: () => i18n.value.commands.elevation.title,
    icon: { is: ElevationIcon },

    execute() {
        if (isElevationEditorOpen.value) closeElevationEditor()
        else openElevationEditor()
    },
}
