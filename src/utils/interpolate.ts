import { pluralForm } from '../i18n/plural'
import { settings } from '../settings'

// Messages with singular and plural forms agree with their first value.
const fill = (message: string, params: string[]) =>
    params.reduce(
        (message, param, index) => message.replace(`{${index}}`, param),
        pluralForm(settings.locale, message, params[0]),
    )

export const interpolate =
    (message: () => string, ...params: (string | (() => string))[]) =>
    () =>
        fill(
            message(),
            params.map((param) => (typeof param === 'string' ? param : param())),
        )

export const interpolateRaw = (message: string, ...params: string[]) => fill(message, params)
