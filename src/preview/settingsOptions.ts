import { computed } from 'vue'
import { panelPositions } from '../editor/workspace/layout'
import { i18n } from '../i18n'
import { previewControls } from './options'

export const panelPositionOptions = computed(() =>
    panelPositions.map(
        (position) => [i18n.value.settings.preview.position[position], position] as const,
    ),
)
export const previewControlOptions = computed(() =>
    previewControls.map((mode) => [i18n.value.settings.preview.controls[mode], mode] as const),
)
