import { onMounted, onUnmounted } from 'vue'
import { modals } from '../../modals'
import { settings } from '../../settings'
import { commands, type CommandName } from '../commands'
import { isInWorkspaceDock } from '../workspace'

// Fields keep every key; buttons keep only the keys that press them.
const keepsDefault = (event: KeyboardEvent) => {
    const { target } = event
    if (target instanceof HTMLButtonElement) return event.key === ' ' || event.key === 'Enter'
    return (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
    )
}

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
    // WebKit Backspace navigation; browser combinations keep theirs.
    if (isShortcut && !event.ctrlKey && !event.altKey && !event.metaKey && !keepsDefault(event))
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
