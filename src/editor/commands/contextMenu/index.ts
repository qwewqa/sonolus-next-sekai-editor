import type { Command } from '..'
import { i18n } from '../../../i18n'
import { closeContextMenu, contextMenu, openSelectionContextMenu } from '../../contextMenu'
import ContextMenuIcon from './ContextMenuIcon.vue'

export const openContextMenu: Command = {
    title: () => i18n.value.commands.openContextMenu.title,
    icon: { is: ContextMenuIcon },
    execute() {
        if (contextMenu.value) closeContextMenu()
        else openSelectionContextMenu()
    },
}
