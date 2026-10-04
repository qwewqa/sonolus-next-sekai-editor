import type { State } from '..'
import type { Entity } from '../entities'
import { getTranslatedSelectionValues, type ScaleAxis } from './scaleValues'
import { transformSelection } from './transformSelection'

export const translateSelection = (
    source: State,
    selected: Entity[],
    axis: ScaleAxis,
    delta: number,
): State => {
    const values = getTranslatedSelectionValues(selected, axis, delta, source)
    return values
        ? transformSelection(
              source,
              selected,
              new Map([...values].map(([entity, value]) => [entity, { [axis]: value }])),
          )
        : source
}
