import assert from 'node:assert/strict'
import test from 'node:test'
import {
    bindingOf,
    blocksDefault,
    browserShortcutOf,
    formatBinding,
    isAltGraphAlphanumeric,
    isReservedChord,
    matchBindings,
    normalizeBinding,
    parseChord,
    stringifyChord,
    type KeyInput,
} from '../../src/editor/controls/bindings'

// Modifiers by letter: c Ctrl, m Meta, a Alt, s Shift, g AltGraph.
const press = (key: string, modifiers = ''): KeyInput => ({
    key,
    ctrlKey: modifiers.includes('c'),
    metaKey: modifiers.includes('m'),
    altKey: modifiers.includes('a'),
    shiftKey: modifiers.includes('s'),
    getModifierState: (name) => name === 'AltGraph' && modifiers.includes('g'),
})

test('chords round trip and plain keys never parse as chords', () => {
    for (const binding of ['Mod+z', 'Mod+Shift+s', 'Mod++', 'Mod+ ', 'Shift+ArrowUp', 'Mod+Alt+F2'])
        assert.equal(stringifyChord(parseChord(binding)!), binding)
    for (const binding of ['+', 'Shift', 'Control', 'Mod', ' ', 'U', 'ArrowUp', 'Mod+'])
        assert.equal(parseChord(binding), undefined)
})

test('a key press records its chord, keeping characters typed with Shift or AltGr plain', () => {
    const cases: [KeyInput, string, boolean?][] = [
        [press('s'), 's'],
        [press('U', 's'), 'U'],
        // A letter's case is Shift's alone, whatever Caps Lock reports.
        [press('A'), 'a'],
        [press('a', 's'), 'A'],
        [press('Ą', 'cag'), 'ą'],
        [press('!', 's'), '!'],
        [press('ArrowUp'), 'ArrowUp'],
        [press(' '), ' '],
        [press('s', 'c'), 'Mod+s'],
        [press('z', 'm'), 'Mod+z'],
        [press('z', 'cm'), 'Mod+z'],
        [press('S', 'cs'), 'Mod+Shift+s'],
        // Caps Lock reports an uppercase letter without Shift.
        [press('Z', 'c'), 'Mod+z'],
        [press('!', 'cs'), 'Mod+!'],
        [press('+', 'cs'), 'Mod++'],
        [press(' ', 'c'), 'Mod+ '],
        [press('a', 'a'), 'Alt+a'],
        [press('ArrowUp', 's'), 'Shift+ArrowUp'],
        [press('ArrowUp', 'c'), 'Mod+ArrowUp'],
        [press('[', 'ca'), '['],
        [press('[', 'g'), '['],
        [press('F2', 'ca'), 'Mod+Alt+F2'],
        // Option types characters on Apple keyboards.
        [press('å', 'a'), 'å', true],
        [press('ArrowUp', 'a'), 'Alt+ArrowUp', true],
    ]
    for (const [input, binding, apple] of cases)
        assert.equal(bindingOf(input, apple ?? false), binding, JSON.stringify(input))
})

test('equal chords share one spelling', () => {
    assert.equal(normalizeBinding('Mod+S'), 'Mod+s')
    assert.equal(normalizeBinding('Mod+Shift+!'), 'Mod+!')
    assert.equal(normalizeBinding('Shift+ArrowUp'), 'Shift+ArrowUp')
    assert.equal(normalizeBinding('U'), 'U')
})

const defaults = {
    undo: 'z',
    copy: 'c',
    slide: 's',
    note: 'a',
    flip: 'u',
    flipVertical: 'U',
    zoomXOut: '[',
    scrollUp: 'ArrowUp',
    play: ' ',
}
const match = (shortcuts: Record<string, string>, input: KeyInput, apple = false) =>
    matchBindings(shortcuts, input, apple)

test('plain bindings answer to their key whatever modifiers are held', () => {
    const cases: [KeyInput, string[]][] = [
        [press('z'), ['undo']],
        [press('z', 'c'), ['undo']],
        [press('z', 'm'), ['undo']],
        [press('s', 'c'), ['slide']],
        [press('a', 'a'), ['note']],
        [press('U', 's'), ['flipVertical']],
        [press('U', 'cs'), ['flipVertical']],
        [press('[', 'ca'), ['zoomXOut']],
        [press('ArrowUp', 'c'), ['scrollUp']],
        [press('ArrowUp', 's'), ['scrollUp']],
        [press(' ', 'c'), ['play']],
        [press('A', 'cs'), []],
        // Letters read by Shift alone: Caps Lock, and Cmd+Shift lowercased on macOS.
        [press('U'), ['flip']],
        [press('Z', 'c'), ['undo']],
        [press('u', 'ms'), ['flipVertical']],
        [press('u', 's'), ['flipVertical']],
    ]
    for (const [input, names] of cases)
        assert.deepEqual(match(defaults, input), { names, exact: false }, JSON.stringify(input))
})

test('a chord bound exactly wins over the plain binding of its key', () => {
    const shortcuts = { ...defaults, save: 'Mod+s', jumpUp: 'Shift+ArrowUp', bpm: 'Alt+a' }
    assert.deepEqual(match(shortcuts, press('s', 'c')), { names: ['save'], exact: true })
    assert.deepEqual(match(shortcuts, press('s', 'm')), { names: ['save'], exact: true })
    assert.deepEqual(match(shortcuts, press('s')).names, ['slide'])
    assert.deepEqual(match(shortcuts, press('s', 'a')).names, ['slide'])
    assert.deepEqual(match(shortcuts, press('S', 'cs')).names, [])
    assert.deepEqual(match(shortcuts, press('ArrowUp', 's')), { names: ['jumpUp'], exact: true })
    assert.deepEqual(match(shortcuts, press('ArrowUp', 'c')).names, ['scrollUp'])
    assert.deepEqual(match(shortcuts, press('a', 'a')), { names: ['bpm'], exact: true })
    assert.deepEqual(match(shortcuts, press('a')).names, ['note'])
    // Caps Lock leaves the chord's letter uppercase.
    assert.deepEqual(match(shortcuts, press('S', 'c')).names, ['save'])
    // Chords never answer to the bare key.
    assert.deepEqual(match({ save: 'Mod+s' }, press('s')).names, [])
})

test('duplicate bindings all run', () => {
    assert.deepEqual(match({ slide: 's', save: 's' }, press('s')).names, ['slide', 'save'])
    assert.deepEqual(match({ slide: 'Mod+s', save: 'Mod+S' }, press('s', 'c')).names, [
        'slide',
        'save',
    ])
})

test('Ctrl+Alt+letter or digit is refused outside Apple platforms, never recorded bare', () => {
    // It records as the bare key, so capture refuses it instead.
    assert.equal(bindingOf(press('k', 'ca'), false), 'k')
    assert.equal(isAltGraphAlphanumeric(press('k', 'ca'), false), true)
    assert.equal(isAltGraphAlphanumeric(press('K', 'cas'), false), true)
    assert.equal(bindingOf(press('1', 'ca'), false), '1')
    assert.equal(isAltGraphAlphanumeric(press('1', 'ca'), false), true)
    // A real AltGr key, Option on Apple, symbols AltGr types and other keys record as they are.
    assert.equal(isAltGraphAlphanumeric(press('ą', 'cag'), false), false)
    assert.equal(isAltGraphAlphanumeric(press('1', 'cag'), false), false)
    assert.equal(isAltGraphAlphanumeric(press('k', 'ca'), true), false)
    assert.equal(isAltGraphAlphanumeric(press('[', 'ca'), false), false)
    assert.equal(isAltGraphAlphanumeric(press('F2', 'ca'), false), false)
    assert.equal(isAltGraphAlphanumeric(press('k', 'c'), false), false)
    assert.equal(isAltGraphAlphanumeric(press('1', 'c'), false), false)
})

test('the browser keeps its reserved chords, per platform', () => {
    assert.equal(isReservedChord(press('w', 'c'), false), true)
    assert.equal(isReservedChord(press('T', 'cs'), false), true)
    assert.equal(isReservedChord(press('F4', 'a'), false), true)
    assert.equal(isReservedChord(press('h', 'c'), false), false)
    assert.equal(isReservedChord(press(' ', 'c'), false), false)
    assert.equal(isReservedChord(press('w', 'm'), false), false)
    assert.equal(isReservedChord(press('h', 'm'), true), true)
    assert.equal(isReservedChord(press('q', 'm'), true), true)
    assert.equal(isReservedChord(press('h', 'c'), true), false)
    assert.equal(isReservedChord(press('s', 'c'), false), false)
})

test('bindings that take a browser shortcut name it', () => {
    assert.equal(browserShortcutOf('Mod+r'), 'reload')
    assert.equal(browserShortcutOf('r'), 'reload')
    assert.equal(browserShortcutOf('R'), 'reload')
    assert.equal(browserShortcutOf('F5'), 'reload')
    assert.equal(browserShortcutOf('f'), 'find')
    assert.equal(browserShortcutOf('Mod+f'), 'find')
    // Zoom keys keep the browser's zoom.
    assert.equal(browserShortcutOf('='), undefined)
    assert.equal(browserShortcutOf('Mod++'), undefined)
    assert.equal(browserShortcutOf('0'), undefined)
    assert.equal(browserShortcutOf('Alt+r'), undefined)
    assert.equal(browserShortcutOf('Mod+s'), undefined)
    assert.equal(browserShortcutOf('ArrowUp'), undefined)
})

test('Ctrl or Cmd keep the browser action out only for letters', () => {
    const cases: [KeyInput, boolean, boolean][] = [
        [press('s'), false, true],
        [press('U', 's'), false, true],
        [press('ArrowUp', 's'), false, true],
        [press('s', 'c'), false, true],
        [press('s', 'm'), false, true],
        [press('S', 'cs'), true, true],
        [press('=', 'c'), false, false],
        [press('0', 'm'), false, false],
        [press('1', 'c'), false, false],
        [press('1', 'c'), true, false],
        [press('[', 'm'), false, false],
        [press('ArrowLeft', 'm'), false, false],
        [press('PageDown', 'c'), true, false],
        [press('ArrowUp', 'c'), false, false],
        // AltGr and Alt keep theirs unless a chord is bound exactly.
        [press('[', 'ca'), false, false],
        [press('a', 'ca'), false, false],
        [press('a', 'a'), false, false],
        [press('a', 'a'), true, true],
    ]
    for (const [input, exact, blocks] of cases)
        assert.equal(blocksDefault(input, exact), blocks, JSON.stringify({ ...input, exact }))
})

test('bindings read as Ctrl chords, or Apple menu symbols', () => {
    assert.equal(formatBinding(' ', false), 'Space')
    assert.equal(formatBinding('U', false), 'Shift+U')
    // Plain letters show as on the keycap; a capital names its Shift.
    assert.equal(formatBinding('s', false), 'S')
    assert.equal(formatBinding('é', false), 'É')
    assert.equal(formatBinding('É', false), 'Shift+É')
    assert.equal(formatBinding('ß', false), 'ß')
    assert.equal(formatBinding('1', false), '1')
    assert.equal(formatBinding(';', false), ';')
    assert.equal(formatBinding('Mod+s', false), 'Ctrl+S')
    assert.equal(formatBinding('Mod+Shift+s', false), 'Ctrl+Shift+S')
    assert.equal(formatBinding('Mod+ ', false), 'Ctrl+Space')
    assert.equal(formatBinding('Alt+ArrowUp', false), 'Alt+↑')
    assert.equal(formatBinding('Mod++', false), 'Ctrl++')
    assert.equal(formatBinding('Mod+Alt+Shift+s', true), '⌥⇧⌘S')
    assert.equal(formatBinding('s', true), 'S')
    assert.equal(formatBinding(undefined, false), undefined)
})

test('named keys read as on the keycap, for display only', () => {
    const names: [string, string][] = [
        ['ArrowLeft', '←'],
        ['ArrowRight', '→'],
        ['ArrowUp', '↑'],
        ['ArrowDown', '↓'],
        ['PageUp', 'Page Up'],
        ['PageDown', 'Page Down'],
        ['Home', 'Home'],
        ['End', 'End'],
        ['Escape', 'Esc'],
        ['Delete', 'Delete'],
        ['Backspace', 'Backspace'],
        ['Enter', 'Enter'],
        ['F5', 'F5'],
    ]
    for (const [key, shown] of names) {
        assert.equal(formatBinding(key, false), shown)
        assert.equal(formatBinding(`Mod+Shift+${key}`, false), `Ctrl+Shift+${shown}`)
        assert.equal(formatBinding(`Mod+${key}`, true), `⌘${shown}`)
    }
    // Stored and matched as the DOM names them.
    assert.equal(bindingOf(press('ArrowLeft'), false), 'ArrowLeft')
    assert.deepEqual(matchBindings({ scrollLeft: 'ArrowLeft' }, press('ArrowLeft'), false).names, [
        'scrollLeft',
    ])
})
