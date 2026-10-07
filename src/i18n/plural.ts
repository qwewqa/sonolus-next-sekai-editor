// Locale codes that are not language tags.
const tags: Partial<Record<string, string>> = { zhs: 'zh-Hans', zht: 'zh-Hant' }

/** The BCP 47 tag for a locale code, as `lang` and `Intl` take it. */
export const languageTag = (locale: string) => tags[locale] ?? locale

const rules = new Map<string, Intl.PluralRules>()

const pluralRules = (locale: string) => {
    let rule = rules.get(locale)
    if (!rule) rules.set(locale, (rule = new Intl.PluralRules(languageTag(locale))))
    return rule
}

/** Picks the singular or plural of "Moved {0} object|Moved {0} objects" by the count. */
export const pluralForm = (locale: string, message: string, count: string | undefined) => {
    const forms = message.split('|')
    if (forms.length < 2) return message
    const one = pluralRules(locale).select(Number(count)) === 'one'
    return (one ? forms[0] : forms[forms.length - 1]) ?? message
}
