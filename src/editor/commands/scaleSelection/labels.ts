import { i18n } from '../../../i18n'
import type { ScaleAxis } from '../../../state/operations/scaleValues'

const labelKeys = { beat: 'scaleBeat', elevation: 'scaleElevation', width: 'scaleWidth' } as const

export const getScaleLabels = (axis: ScaleAxis) => i18n.value.commands[labelKeys[axis]]
