import { computed } from 'vue'
import { settings } from '../settings'
import { setInterpolationLocale } from '../utils/interpolate'
import { localizations } from './localizations'

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
export const i18n = computed(() => localizations[settings.locale]!)

setInterpolationLocale(() => settings.locale)
