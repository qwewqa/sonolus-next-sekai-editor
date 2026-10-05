import { onMounted, onUnmounted } from 'vue'
import { modals } from '../../modals'
import { settings } from '../../settings'
import { commands, type CommandName } from '../commands'
import { isInWorkspaceDock } from '../workspace'

const isControl = (target: EventTarget | null) =>
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLButtonElement ||
    (target instanceof HTMLElement && target.isContentEditable)

const onKeydown = (event: KeyboardEvent) => {
    if (modals.length) return
    if (isInWorkspaceDock(document.activeElement)) return

    let isShortcut = false
    for (const [name, key] of Object.entries(settings.keyboardShortcuts) as [
        CommandName,
        string | undefined,
    ][]) {
        if (key !== event.key) continue

        isShortcut = true
        void commands[name].execute()
    }

    // Handled plain keys skip browser defaults such as Firefox quick find and
    // WebKit Backspace navigation; combinations and focused controls keep theirs.
    if (isShortcut && !event.ctrlKey && !event.altKey && !event.metaKey && !isControl(event.target))
        event.preventDefault()
}

export const useKeyboardControl = () => {
    onMounted(() => {
        addEventListener('keydown', onKeydown)
    })

    onUnmounted(() => {
        removeEventListener('keydown', onKeydown)
    })
}
