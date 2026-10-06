import { onMounted, onUnmounted } from 'vue'
import { modals } from '../../modals'
import { settings } from '../../settings'
import { commands } from '../commands'
import { isInWorkspaceDock } from '../workspace'
import {
    blocksDefault,
    isApplePlatform,
    isCharacter,
    isCommandChord,
    matchBindings,
} from './bindings'

const isTextEntry = (target: EventTarget | null) =>
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLInputElement &&
        !['button', 'checkbox', 'radio', 'range', 'color', 'file'].includes(target.type)) ||
    (target instanceof HTMLElement && target.isContentEditable)

// Space and Enter press a focused button, and nothing else.
const pressesButton = (event: KeyboardEvent) =>
    event.target instanceof HTMLButtonElement && (event.key === ' ' || event.key === 'Enter')

// Fields keep every key.
const keepsDefault = (event: KeyboardEvent) => {
    const { target } = event
    return (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
    )
}

const isApple = isApplePlatform()

const onKeydown = (event: KeyboardEvent) => {
    if (modals.length || pressesButton(event)) return

    const commandChord = isCommandChord(event) && isCharacter(event.key)
    // In docks, fields keep their keys; other controls pass only unclaimed Ctrl or Cmd chords.
    if (isInWorkspaceDock(document.activeElement)) {
        if (!commandChord || event.defaultPrevented || isTextEntry(document.activeElement)) return
    }

    const { names, exact } = matchBindings(settings.keyboardShortcuts, event, isApple)
    for (const name of names) void commands[name].execute()
    if (!names.length || keepsDefault(event)) return
    // Selected page text keeps its native copy and cut.
    if (
        isCommandChord(event) &&
        names.some((name) => name === 'copy' || name === 'cut') &&
        getSelection()?.isCollapsed === false
    )
        return

    // Handled keys skip browser defaults such as Firefox quick find, WebKit Backspace
    // navigation and Ctrl+S saving the page; zoom and tab keys keep theirs.
    if (blocksDefault(event, exact)) event.preventDefault()
}

export const useKeyboardControl = () => {
    onMounted(() => {
        addEventListener('keydown', onKeydown)
    })

    onUnmounted(() => {
        removeEventListener('keydown', onKeydown)
    })
}
