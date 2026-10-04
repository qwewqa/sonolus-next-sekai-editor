import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import test from 'node:test'

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
            assert.deepEqual(placeholders(text), placeholders(english[key]!), `${locale}.${key}`)
        }
    })
}
