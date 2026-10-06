import { onMounted, onUnmounted } from 'vue'
import { modals } from '../../modals'
import { settings } from '../../settings'
import { commands, type CommandName } from '../commands'
import { isInWorkspaceDock } from '../workspace'

/** Commands that also run with Ctrl or Cmd, as in every editor. */
const editingCommands: readonly CommandName[] = ['undo', 'redo', 'cut', 'copy', 'paste']

const isTextEntry = (target: EventTarget | null) =>
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLInputElement &&
        !['button', 'checkbox', 'radio', 'range', 'color', 'file'].includes(target.type)) ||
    (target instanceof HTMLElement && target.isContentEditable)

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

// Ctrl+Alt is AltGr on many layouts, which types characters such as [ and ].
const isCommandChord = (event: KeyboardEvent) =>
    (event.ctrlKey || event.metaKey) && !event.altKey && !event.getModifierState('AltGraph')

const isCharacter = (key: string) => key.length === 1 && key !== ' '

const onKeydown = (event: KeyboardEvent) => {
    if (modals.length) return

    // Ctrl or Cmd with a character runs only the editing commands.
    const editingOnly = isCommandChord(event) && isCharacter(event.key)
    // In docks, fields keep their keys; other controls pass only unclaimed editing chords.
    if (isInWorkspaceDock(document.activeElement)) {
        if (!editingOnly || event.defaultPrevented || isTextEntry(document.activeElement)) return
    }

    let isShortcut = false
    for (const [name, key] of Object.entries(settings.keyboardShortcuts) as [
        CommandName,
        string | undefined,
    ][]) {
        if (key !== event.key) continue
        if (editingOnly && !editingCommands.includes(name)) continue

        isShortcut = true
        void commands[name].execute()
    }
    if (!isShortcut || keepsDefault(event)) return
    // Selected page text keeps its native copy, as before chords were blocked.
    if (editingOnly && getSelection()?.isCollapsed === false) return

    // Handled plain keys skip browser defaults such as Firefox quick find and
    // WebKit Backspace navigation, and handled editing chords skip theirs.
    if (editingOnly || (!event.ctrlKey && !event.altKey && !event.metaKey)) event.preventDefault()
}

export const useKeyboardControl = () => {
    onMounted(() => {
        addEventListener('keydown', onKeydown)
    })

    onUnmounted(() => {
        removeEventListener('keydown', onKeydown)
    })
}
