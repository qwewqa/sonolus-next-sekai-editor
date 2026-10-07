/**
 * Shortcut bindings: a plain `event.key` (Shift folded into the key, as `U`), or a
 * chord `[Mod+][Alt+][Shift+]key`. Mod is Ctrl or Cmd on every platform.
 */

/** The parts of a key event that bindings read; a KeyboardEvent fits. */
export type KeyInput = {
    key: string
    ctrlKey: boolean
    metaKey: boolean
    altKey: boolean
    shiftKey: boolean
    getModifierState?: (key: string) => boolean
}

export type Chord = {
    mod: boolean
    alt: boolean
    shift: boolean
    key: string
}

export const isCharacter = (key: string) => key.length === 1 && key !== ' '

const isLetter = (key: string) => isCharacter(key) && key.toLowerCase() !== key.toUpperCase()

// A letter's case is Shift's alone, whatever Caps Lock or the platform report.
const plainKey = ({ key, shiftKey }: KeyInput) =>
    isLetter(key) ? (shiftKey ? key.toUpperCase() : key.toLowerCase()) : key

const prefixes = [
    ['mod', 'Mod+'],
    ['alt', 'Alt+'],
    ['shift', 'Shift+'],
] as const

export const parseChord = (binding: string): Chord | undefined => {
    const chord: Chord = { mod: false, alt: false, shift: false, key: binding }
    for (const [name, prefix] of prefixes) {
        if (!chord.key.startsWith(prefix) || chord.key.length === prefix.length) continue
        chord[name] = true
        chord.key = chord.key.slice(prefix.length)
    }
    return chord.key === binding ? undefined : chord
}

export const stringifyChord = ({ mod, alt, shift, key }: Chord) =>
    `${mod ? 'Mod+' : ''}${alt ? 'Alt+' : ''}${shift ? 'Shift+' : ''}${key}`

// Ctrl+Alt is AltGr on many layouts, which types characters such as [ and ].
const isAltGraph = (input: KeyInput) =>
    !!input.getModifierState?.('AltGraph') || (input.ctrlKey && input.altKey)

/**
 * Ctrl+Alt+letter or digit outside Apple platforms: read as AltGr, so it can be
 * neither recorded nor matched as a chord.
 */
export const isAltGraphAlphanumeric = (input: KeyInput, apple: boolean) =>
    !apple &&
    input.ctrlKey &&
    input.altKey &&
    !input.getModifierState?.('AltGraph') &&
    (isLetter(input.key) || /^[0-9]$/.test(input.key))

/** Ctrl or Cmd held as a command modifier, not as part of AltGr. */
export const isCommandChord = (input: KeyInput) =>
    (input.ctrlKey || input.metaKey) && !input.altKey && !input.getModifierState?.('AltGraph')

/** The binding a key press records: letters lowercase with Shift spelled out. */
export const bindingOf = (input: KeyInput, apple: boolean) => {
    const { key } = input
    const character = isCharacter(key)
    if (character && isAltGraph(input)) return plainKey(input)
    const mod = input.ctrlKey || input.metaKey
    // Option types characters on Apple keyboards, as AltGr does elsewhere.
    const alt = input.altKey && !(apple && character)
    if (!mod && !alt && (character || !input.shiftKey)) return plainKey(input)
    const letter = isLetter(key)
    return stringifyChord({
        mod,
        alt,
        shift: input.shiftKey && (letter || !character),
        key: letter ? key.toLowerCase() : key,
    })
}

/** One spelling per binding, so equal chords compare equal. */
export const normalizeBinding = (binding: string) => {
    const chord = parseChord(binding)
    if (!chord) return binding
    return stringifyChord(
        isLetter(chord.key)
            ? { ...chord, key: chord.key.toLowerCase() }
            : { ...chord, shift: chord.shift && !isCharacter(chord.key) },
    )
}

/**
 * Names bound to a key press. A chord bound exactly wins; otherwise plain
 * bindings match the key whatever modifiers are held.
 */
export const matchBindings = <N extends string>(
    shortcuts: Partial<Record<N, string>>,
    input: KeyInput,
    apple: boolean,
) => {
    const entries = Object.entries(shortcuts) as [N, string | undefined][]
    const binding = bindingOf(input, apple)
    if (parseChord(binding)) {
        const names = entries
            .filter(
                ([, value]) => value && parseChord(value) && normalizeBinding(value) === binding,
            )
            .map(([name]) => name)
        if (names.length) return { names, exact: true }
    }
    const key = plainKey(input)
    const names = entries
        .filter(([, value]) => value === key && !parseChord(value))
        .map(([name]) => name)
    return { names, exact: false }
}

/**
 * Whether a handled key keeps the browser's action out. With Ctrl or Cmd only
 * letters do (save, print, find...); zoom, tab switching and navigation stay.
 */
export const blocksDefault = (input: KeyInput, exact: boolean) => {
    if (input.ctrlKey || input.metaKey)
        return /^[a-z]$/i.test(input.key) && (exact || isCommandChord(input))
    return exact || !input.altKey
}

/** The Ctrl or Cmd chord a binding takes: its own, or a plain character's. */
const commandChordOf = (binding: string): Chord | undefined => {
    const chord = parseChord(binding)
    if (chord) return chord.mod && !chord.alt ? chord : undefined
    if (!isCharacter(binding)) return
    return isLetter(binding)
        ? {
              mod: true,
              alt: false,
              shift: binding !== binding.toLowerCase(),
              key: binding.toLowerCase(),
          }
        : { mod: true, alt: false, shift: false, key: binding }
}

export type BrowserShortcut = 'reload' | 'find'

/** The browser action a binding replaces while the editor has focus. */
export const browserShortcutOf = (binding: string): BrowserShortcut | undefined => {
    if (binding === 'F5') return 'reload'
    const chord = commandChordOf(binding)
    if (!chord) return
    if (chord.key === 'r') return 'reload'
    if (chord.key === 'f' && !chord.shift) return 'find'
}

/** The chord a plain character binding also answers to, for conflicts with chords. */
export const commandChordBinding = (binding: string) => {
    const chord = commandChordOf(binding)
    return chord && stringifyChord(chord)
}

/** Chords the browser or OS keeps for itself, so pages never receive them. */
export const isReservedChord = (input: KeyInput, apple: boolean) => {
    const key = input.key.toLowerCase()
    if (apple) {
        if (!input.metaKey) return false
        if (input.altKey && key === 'escape') return true
        return !input.altKey && ['q', 'w', 't', 'n', 'h', 'm', ' ', '`', 'tab'].includes(key)
    }
    if (input.altKey && !input.ctrlKey && (key === 'f4' || key === 'tab')) return true
    if (!input.ctrlKey || input.metaKey || input.altKey) return false
    return ['n', 't', 'w', 'tab', 'escape'].includes(key)
}

// Keys whose DOM names read poorly; shown only, never stored.
const keyNames = new Map([
    [' ', 'Space'],
    ['ArrowLeft', '←'],
    ['ArrowRight', '→'],
    ['ArrowUp', '↑'],
    ['ArrowDown', '↓'],
    ['PageUp', 'Page Up'],
    ['PageDown', 'Page Down'],
    ['Escape', 'Esc'],
])

/** Readable text for a binding; Apple platforms use the menu symbols. */
export const formatBinding = (binding: string | undefined, apple: boolean) => {
    if (!binding) return
    const chord = parseChord(binding)
    if (!chord) {
        // Letters show as on the keycap; Shift is named, so a capital is never ambiguous.
        const named = keyNames.get(binding)
        if (named) return named
        const upper = binding.toUpperCase()
        if (!isLetter(binding) || upper.length !== 1) return binding
        return binding === upper ? `Shift+${binding}` : upper
    }
    const key =
        keyNames.get(chord.key) ?? (isLetter(chord.key) ? chord.key.toUpperCase() : chord.key)
    if (apple)
        return `${chord.alt ? '⌥' : ''}${chord.shift ? '⇧' : ''}${chord.mod ? '⌘' : ''}${key}`
    return [chord.mod && 'Ctrl', chord.alt && 'Alt', chord.shift && 'Shift', key]
        .filter(Boolean)
        .join('+')
}

/** Macs, iPads and iPhones, where Cmd plays Ctrl's part. */
export const isApplePlatform = () => {
    if (typeof navigator === 'undefined') return false
    const data = (navigator as { userAgentData?: { platform?: string } }).userAgentData
    return /mac|iphone|ipad|ipod/i.test(data?.platform ?? navigator.platform)
}

/** A shown shortcut that is one punctuation mark, which needs more size and weight to read. */
export const isPunctuationShortcut = (shortcut: string) => /^[!-/:-@[-`{-~]$/.test(shortcut)

/** A binding as this device shows it. */
export const formatShortcut = (binding: string | undefined) =>
    formatBinding(binding, isApplePlatform())
