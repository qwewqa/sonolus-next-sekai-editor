import type { State } from '..'
import type { Entity } from '../entities'
import { getScaledSelectionValues, type ScaleAxis } from './scaleValues'
import { transformSelection } from './transformSelection'

export { canScaleSelection, type ScaleAxis } from './scaleValues'

export const scaleSelection = (
    source: State,
    selected: Entity[],
    axis: ScaleAxis,
    factor: number,
): State => {
    const values = getScaledSelectionValues(selected, axis, factor, source)
    return values
        ? transformSelection(
              source,
              selected,
              new Map([...values].map(([entity, value]) => [entity, { [axis]: value }])),
          )
        : source
}
