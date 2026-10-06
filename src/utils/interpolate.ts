import { pluralForm } from '../i18n/plural'

// Set by i18n, so this module stays off the settings import cycle.
let currentLocale = () => 'en'

/** Names the locale whose plural rules messages follow. */
export const setInterpolationLocale = (locale: () => string) => {
    currentLocale = locale
}

// Messages with singular and plural forms agree with their first value.
// One pass, so values go in verbatim, even with "$&" or "{1}" in them.
const fill = (message: string, params: string[]) =>
    pluralForm(currentLocale(), message, params[0]).replace(
        /\{(\d+)\}/g,
        (placeholder, index: string) => params[Number(index)] ?? placeholder,
    )

export const interpolate =
    (message: () => string, ...params: (string | (() => string))[]) =>
    () =>
        fill(
            message(),
            params.map((param) => (typeof param === 'string' ? param : param())),
        )

export const interpolateRaw = (message: string, ...params: string[]) => fill(message, params)
