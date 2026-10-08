import { onMounted, onUnmounted, watch } from 'vue'
import { selectedEntities } from '../../history/selectedEntities'
import { isBlockingModalOpen, isToolModalOpen } from '../../modals'
import { holdsTyping } from '../../modals/form/resync'
import { settings } from '../../settings'
import { commands, type CommandName } from '../commands'
import { takesDockKeys } from '../workspace'
import {
    blocksDefault,
    isApplePlatform,
    isCharacter,
    isCommandChord,
    matchBindings,
} from './bindings'
import { clearPageSelection } from './pageSelection'

const isTextEntry = (target: EventTarget | null) =>
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLInputElement &&
        !['button', 'checkbox', 'radio', 'range', 'color', 'file'].includes(target.type)) ||
    (target instanceof HTMLElement && target.isContentEditable)

// Space and Enter press a focused button, and Space a checkbox or radio, and nothing else.
const pressesButton = ({ target, key }: KeyboardEvent) => {
    if (
        target instanceof HTMLButtonElement ||
        (target instanceof HTMLInputElement && ['button', 'submit', 'reset'].includes(target.type))
    )
        return key === ' ' || key === 'Enter'
    return (
        target instanceof HTMLInputElement &&
        ['checkbox', 'radio'].includes(target.type) &&
        key === ' '
    )
}

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

const isInToolDialog = (element: Element | null) => !!element?.closest('[data-tool-dialog]')

// Radios and chip rows move with arrow keys.
const movesFocus = (element: Element, key: string) =>
    /^(Arrow|Home$|End$)/.test(key) && element.matches('input[type="radio"], [role="toolbar"] *')

// Only the commands Help lists repeat when held; the rest act once per press.
const repeatsWhenHeld = new Set<CommandName>([
    'scrollLeft',
    'scrollRight',
    'scrollUp',
    'scrollDown',
    'scrollPageUp',
    'scrollPageDown',
    'zoomXIn',
    'zoomXOut',
    'zoomYIn',
    'zoomYOut',
    'undo',
    'redo',
    'increaseNoteSize',
    'decreaseNoteSize',
    'speedUp',
    'speedDown',
    'groupPrev',
    'groupNext',
    'stagePrev',
    'stageNext',
])

const onKeydown = (event: KeyboardEvent) => {
    if (isBlockingModalOpen.value || pressesButton(event)) return
    // An open tool dialog takes Escape.
    if (isToolModalOpen.value && event.key === 'Escape') return

    const commandChord = isCommandChord(event) && isCharacter(event.key)
    const active = document.activeElement
    const { names, exact } = matchBindings(settings.keyboardShortcuts, event, isApple)
    // A field showing its committed value passes undo and redo to the editor.
    const passesHistory =
        commandChord &&
        isTextEntry(active) &&
        names.some((name) => name === 'undo' || name === 'redo') &&
        !holdsTyping(active)
    // In docks, fields keep their keys; other controls pass only unclaimed Ctrl or Cmd chords.
    // Tool dialogs float over the chart, so only their fields and selects hold keys that way.
    const inDialog = isInToolDialog(active)
    if (
        takesDockKeys(active) ||
        (inDialog && (isTextEntry(active) || active instanceof HTMLSelectElement))
    ) {
        if (!commandChord || event.defaultPrevented || (isTextEntry(active) && !passesHistory))
            return
    }
    if (inDialog && active && movesFocus(active, event.key)) return

    // Selected page text keeps its native copy and cut, and the objects stay as they are.
    if (
        isCommandChord(event) &&
        names.some((name) => name === 'copy' || name === 'cut') &&
        String(getSelection() ?? '').trim() !== ''
    )
        return
    for (const name of names) {
        if (event.repeat && !repeatsWhenHeld.has(name)) continue
        void commands[name].execute()
    }
    if (!names.length) return
    // A command chord has no native use outside text entry, so selects and toggles drop it.
    if (
        keepsDefault(event) &&
        !(isCommandChord(event) && (passesHistory || !isTextEntry(event.target)))
    )
        return

    // Handled keys skip browser defaults such as Firefox quick find, WebKit Backspace
    // navigation and Ctrl+S saving the page; zoom and tab keys keep theirs.
    if (blocksDefault(event, exact)) event.preventDefault()
}

export const useKeyboardControl = () => {
    // A new object selection drops page text selected before it, so Ctrl+C copies the objects.
    watch(
        selectedEntities,
        () => {
            if (!isTextEntry(document.activeElement)) clearPageSelection()
        },
        { flush: 'sync' },
    )

    onMounted(() => {
        addEventListener('keydown', onKeydown)
    })

    onUnmounted(() => {
        removeEventListener('keydown', onKeydown)
    })
}
