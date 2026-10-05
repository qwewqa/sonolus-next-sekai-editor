import { i18n } from '../../i18n'
import { interpolateRaw } from '../../utils/interpolate'

export const unknownLabel = (value: unknown) =>
    interpolateRaw(i18n.value.modals.form.unknown, String(value))
