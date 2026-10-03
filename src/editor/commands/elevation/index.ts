import type { Command } from '..'
import { i18n } from '../../../i18n'
import {
    closeElevationEditor,
    isElevationEditorOpen,
    openElevationEditor,
} from '../../elevation/state'
import FlipIcon from '../flip/FlipIcon.vue'

export const elevation: Command = {
    title: () => i18n.value.commands.elevation.title,
    icon: { is: FlipIcon, props: { class: 'rotate-90' } },

    execute() {
        if (isElevationEditorOpen.value) closeElevationEditor()
        else openElevationEditor()
    },
}
