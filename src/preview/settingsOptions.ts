import { computed } from 'vue'
import { i18n } from '../i18n'
import { previewControls, previewPositions } from './options'

export const previewPositionOptions = computed(() =>
    previewPositions.map(
        (position) => [i18n.value.settings.preview.position[position], position] as const,
    ),
)
export const previewControlOptions = computed(() =>
    previewControls.map((mode) => [i18n.value.settings.preview.controls[mode], mode] as const),
)
