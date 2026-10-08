import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import test from 'node:test'
import { languageTag, pluralForm } from '../../src/i18n/plural'

type Localization = { [key: string]: string | Localization }
const directory = new URL('../../src/i18n/', import.meta.url)
const flatten = (localization: Localization, prefix = ''): Record<string, string> =>
    Object.fromEntries(
        Object.entries(localization).flatMap(([key, value]) => {
            const path = prefix ? `${prefix}.${key}` : key
            return typeof value === 'string'
                ? [[path, value]]
                : Object.entries(flatten(value, path))
        }),
    )
const read = (locale: string) =>
    flatten(
        JSON.parse(
            readFileSync(new URL(`${locale}/index.json`, directory), 'utf8'),
        ) as Localization,
    )
const english = read('en')
const placeholders = (text: string) => (text.match(/\{\d+\}/g) ?? []).sort()
// Singular and plural forms, as "{0} object|{0} objects", each hold every placeholder.
const forms = (text: string) => text.split('|')

test('English messages have at most a singular and a plural form', () => {
    for (const [key, text] of Object.entries(english)) {
        assert.ok(forms(text).length <= 2, key)
        for (const form of forms(text))
            assert.deepEqual(placeholders(form), placeholders(forms(text)[0]!), key)
    }
})

for (const locale of readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== 'en')
    .map((entry) => entry.name)) {
    test(`${locale} includes every English message and preserves interpolation placeholders`, () => {
        const translated = read(locale)
        assert.deepEqual(Object.keys(translated).sort(), Object.keys(english).sort())
        for (const [key, text] of Object.entries(translated)) {
            assert.ok(text.trim(), `${locale}.${key}: empty translation`)
            assert.ok(
                !/\uFFFD|\?{2,}|\p{L}\?\p{L}/u.test(text),
                `${locale}.${key}: damaged Unicode`,
            )
            assert.ok(forms(text).length <= 2, `${locale}.${key}: too many forms`)
            for (const form of forms(text))
                assert.deepEqual(
                    placeholders(form),
                    placeholders(forms(english[key]!)[0]!),
                    `${locale}.${key}`,
                )
        }
    })
}

test('plural forms follow each locale’s rules', () => {
    const message = '{0} object|{0} objects'
    assert.equal(pluralForm('en', message, '1'), '{0} object')
    assert.equal(pluralForm('en', message, '0'), '{0} objects')
    assert.equal(pluralForm('en', message, '2'), '{0} objects')
    // French counts zero as singular.
    assert.equal(pluralForm('fr', message, '0'), '{0} object')
    assert.equal(pluralForm('fr', message, '2'), '{0} objects')
    // Chinese has one form; locale codes map to language tags.
    assert.equal(pluralForm('zhs', message, '1'), '{0} objects')
    assert.equal(pluralForm('en', 'Saved', '1'), 'Saved')
})

test('every locale has a language tag that names its script', () => {
    const scripts: Record<string, string> = {
        en: 'Latn',
        fr: 'Latn',
        ja: 'Jpan',
        ko: 'Kore',
        tr: 'Latn',
        zhs: 'Hans',
        zht: 'Hant',
    }
    for (const locale of readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)) {
        // An unknown code such as "zht" maximizes to no script, so Chinese fonts fall back.
        assert.equal(
            new Intl.Locale(languageTag(locale)).maximize().script,
            scripts[locale],
            locale,
        )
    }
})

test('status bar scope names start with a capital where the script has case', () => {
    for (const locale of readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)) {
        const messages = read(locale)
        for (const key of [
            'statusBar.group.all',
            'statusBar.group.one',
            'statusBar.stage.all',
            'statusBar.stage.one',
        ]) {
            // A leading placeholder is the name itself, as in Turkish "{0} grubu".
            const first = messages[key]!.charAt(0)
            assert.equal(first, first.toLocaleUpperCase(locale), `${locale} ${key}`)
        }
    }
})

test('group and stage names stand apart from the noun after them', () => {
    for (const locale of ['ja', 'ko', 'zhs', 'zht']) {
        const messages = read(locale)
        for (const key of ['statusBar.group.one', 'statusBar.stage.one']) {
            // Names such as "Verse" or Korean "기본" (Default) don't run into the noun or take 번 ("number").
            assert.match(messages[key]!, /^\{0\} \S/, `${locale} ${key}`)
            assert.doesNotMatch(messages[key]!, /번/, `${locale} ${key}`)
        }
    }
    for (const [key, text] of Object.entries(read('ko')))
        assert.doesNotMatch(text, /\{\d+\}번/, `ko ${key}`)
})

test('both flip commands name their axis', () => {
    for (const locale of readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)) {
        const messages = read(locale)
        // As French "Retourner" beside "Retourner verticalement" did not.
        const horizontal = messages['commands.flip.title']!
        const vertical = messages['commands.flipVertical.title']!
        assert.ok(!vertical.startsWith(horizontal) && !horizontal.startsWith(vertical), locale)
    }
})

test('division commands are named as their dialog is, as lane division commands are', () => {
    for (const locale of readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)) {
        const messages = read(locale)
        // Not French "Passer à la division personnalisée" beside "Division personnalisée".
        for (const axis of ['divisions', 'laneDivisions'])
            assert.equal(
                messages[`commands.${axis}.custom.title`],
                messages[`commands.${axis}.custom.modal.title`],
                `${locale} ${axis}`,
            )
        // A noun with the fraction, not "Passer à la division en 1/4".
        const title = messages['commands.divisions.title']!
        assert.ok(title.replace('1/{0}', '').trim().split(/\s+/).length <= 2, locale)
    }
})

test('unit labels follow their locale’s pattern', () => {
    const unit = '\\((?:초|밀리초|비트|레인|%|秒|毫秒|拍|ミリ秒)\\)'
    // Japanese and Korean put a space before the parenthesis.
    for (const locale of ['ja', 'ko'])
        for (const [key, text] of Object.entries(read(locale)))
            assert.doesNotMatch(text, new RegExp(`[^\\s]${unit}`), `${locale} ${key}`)
    // Chinese uses full-width parentheses.
    for (const locale of ['zhs', 'zht'])
        for (const [key, text] of Object.entries(read(locale)))
            assert.doesNotMatch(text, new RegExp(unit), `${locale} ${key}`)
})

test('the Japanese capture tooltip says what its prompt says', () => {
    const messages = read('ja')
    // As the prompt "キーを押すか、もう一度クリックして削除", not a longer sentence.
    assert.ok(messages['modals.form.key.press']!.includes('もう一度クリックして削除'))
    assert.match(messages['modals.form.key.clear']!, /^もう一度クリックして\S*削除$/)
})

test('Japanese writes すべて, never 全て', () => {
    for (const [key, text] of Object.entries(read('ja'))) assert.doesNotMatch(text, /全て/, key)
})

test('Japanese writes ペースト, as the command, never 貼り付け', () => {
    for (const [key, text] of Object.entries(read('ja'))) assert.doesNotMatch(text, /貼り付/, key)
})

test('Korean show settings all end in 표시', () => {
    for (const [key, text] of Object.entries(read('ko')))
        if (/^settings\.editor\.show/.test(key)) assert.match(text, /표시$/, key)
})

test('English uses curly apostrophes', () => {
    for (const [key, text] of Object.entries(english)) assert.doesNotMatch(text, /'/, key)
})

test('French text uses one typographic style', () => {
    for (const [key, text] of Object.entries(read('fr'))) {
        assert.doesNotMatch(text, /'/, `fr ${key}: curly apostrophes, as most of fr`)
        // A no-break space before ? ! ; (narrow) and : %, so the mark never wraps alone; "(%)" is a unit.
        assert.doesNotMatch(text, /[^\u202f][?!;]|[^\u00a0(][:%]/, `fr ${key}`)
    }
})

test('Preview Editor units stay on the line of the word before them', () => {
    for (const locale of readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name))
        for (const [key, text] of Object.entries(read(locale)))
            // As fr "Durée du fondu de sortie (s)", which left "(s)" alone at 390.
            if (key.startsWith('utilities.previewEditor.'))
                assert.doesNotMatch(text, / [(（]/, `${locale} ${key}`)
})

test('the version line is translated where the script differs from English', () => {
    for (const locale of ['ja', 'ko', 'zhs', 'zht'])
        assert.doesNotMatch(read(locale)['notification.title']!, /Version/, locale)
})

test('shortcut refusal notes end in a full stop, as in English', () => {
    for (const locale of ['en', 'fr', 'tr', 'zhs', 'zht'])
        for (const key of ['modals.form.key.reserved', 'modals.form.key.altGraph'])
            assert.match(read(locale)[key]!, /[.。]$/, `${locale} ${key}`)
})

test('event tool names start with a capital where the script has case', () => {
    for (const locale of readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)) {
        const messages = read(locale)
        for (const [key, text] of Object.entries(messages)) {
            if (!key.startsWith('events.')) continue
            const first = text.charAt(0)
            assert.equal(first, first.toLocaleUpperCase(locale), `${locale} ${key}`)
        }
    }
})

test('Turkish command titles use Title Case', () => {
    const messages = read('tr')
    const titles = Object.entries(messages).filter(
        ([key]) =>
            key.startsWith('commands.') && !key.includes('.modal.') && /\.title(\.|$)/.test(key),
    )
    for (const [key, text] of [
        ...titles,
        ...['contextMenu.title', 'contextMenu.editProperties', 'elevation.edit'].map(
            (key) => [key, messages[key]!] as const,
        ),
    ])
        for (const word of text.replace(/\{\d+\}/g, '').split(/[\s/]+/)) {
            const first = word.match(/\p{L}/u)?.[0]
            if (first) assert.equal(first, first.toLocaleUpperCase('tr'), `tr ${key}: ${text}`)
        }
})
